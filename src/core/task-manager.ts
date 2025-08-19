/**
 * 任务生命周期管理
 * 负责任务的创建、执行、监控和状态管理
 */

import { Task, TaskStatus, Plan, Run, RunStatus, EventType } from './types';
import { getDefaultEventBus } from './event-bus';
import { getDefaultLogger } from './logger';
import { getDefaultErrorHandler } from './error-handler';

export interface TaskManagerConfig {
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  enableAutoCleanup: boolean;
  cleanupIntervalMs: number;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private runs: Map<string, Run> = new Map();
  private activeTasks: Set<string> = new Set();
  private config: TaskManagerConfig;
  private eventBus = getDefaultEventBus();
  private logger = getDefaultLogger();
  private errorHandler = getDefaultErrorHandler();
  private cleanupTimer: any;

  constructor(config: Partial<TaskManagerConfig> = {}) {
    this.config = {
      maxConcurrentTasks: 5,
      taskTimeoutMs: 30 * 60 * 1000, // 30分钟
      enableAutoCleanup: true,
      cleanupIntervalMs: 10 * 60 * 1000, // 10分钟
      ...config
    };

    if (this.config.enableAutoCleanup) {
      this.startAutoCleanup();
    }

    this.setupEventListeners();
  }

  /**
   * 创建任务
   */
  async createTask(intent: string, options: {
    name?: string;
    userId?: string;
    metadata?: Record<string, any>;
  } = {}): Promise<Task> {
    const task: Task = {
      id: this.generateId(),
      name: options.name || `Task ${Date.now()}`,
      intent,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: TaskStatus.PENDING,
      userId: options.userId,
      metadata: options.metadata
    };

    this.tasks.set(task.id, task);
    
    this.logger.info(`Task created: ${task.id}`, {
      taskId: task.id,
      intent: task.intent,
      userId: task.userId
    });

    this.eventBus.publish(EventType.TASK_CREATED, task, 'task-manager');
    
    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(filter?: {
    status?: TaskStatus;
    userId?: string;
    since?: Date;
    limit?: number;
  }): Task[] {
    let tasks = Array.from(this.tasks.values());

    if (filter) {
      if (filter.status) {
        tasks = tasks.filter(t => t.status === filter.status);
      }
      if (filter.userId) {
        tasks = tasks.filter(t => t.userId === filter.userId);
      }
      if (filter.since) {
        tasks = tasks.filter(t => t.createdAt >= filter.since!);
      }
      if (filter.limit) {
        tasks = tasks.slice(-filter.limit);
      }
    }

    return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(taskId: string, status: TaskStatus, metadata?: Record<string, any>): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const oldStatus = task.status;
    task.status = status;
    task.updatedAt = new Date();
    
    if (metadata) {
      task.metadata = { ...task.metadata, ...metadata };
    }

    this.logger.info(`Task status updated: ${taskId} ${oldStatus} -> ${status}`);

    // 发布状态变更事件
    switch (status) {
      case TaskStatus.RUNNING:
        this.activeTasks.add(taskId);
        this.eventBus.publish(EventType.TASK_STARTED, task, 'task-manager');
        break;
      case TaskStatus.COMPLETED:
        this.activeTasks.delete(taskId);
        this.eventBus.publish(EventType.TASK_COMPLETED, task, 'task-manager');
        break;
      case TaskStatus.FAILED:
      case TaskStatus.CANCELLED:
        this.activeTasks.delete(taskId);
        this.eventBus.publish(EventType.TASK_FAILED, task, 'task-manager');
        break;
    }
  }

  /**
   * 开始执行任务
   */
  async startTask(taskId: string, plan: Plan): Promise<Run> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 检查并发限制
    if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
      throw new Error('Maximum concurrent tasks limit reached');
    }

    // 创建运行记录
    const run: Run = {
      runId: this.generateId(),
      taskId,
      planId: plan.id,
      startTime: new Date(),
      status: RunStatus.INITIALIZING,
      logs: [],
      screenshots: [],
      progress: {
        currentStepIndex: 0,
        totalSteps: plan.steps.length,
        completedSteps: 0,
        failedSteps: 0,
        percentage: 0
      }
    };

    this.runs.set(run.runId, run);
    await this.updateTaskStatus(taskId, TaskStatus.RUNNING);
    
    this.logger.info(`Task execution started: ${taskId}`, {
      runId: run.runId,
      planId: plan.id,
      totalSteps: plan.steps.length
    });

    return run;
  }

  /**
   * 获取运行记录
   */
  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  /**
   * 获取任务的运行记录
   */
  getTaskRuns(taskId: string): Run[] {
    return Array.from(this.runs.values())
      .filter(run => run.taskId === taskId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  /**
   * 更新运行进度
   */
  async updateRunProgress(runId: string, progress: Partial<Run['progress']>): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    run.progress = { ...run.progress, ...progress };
    
    // 计算百分比
    if (progress.completedSteps !== undefined || progress.totalSteps !== undefined) {
      run.progress.percentage = Math.round(
        (run.progress.completedSteps / run.progress.totalSteps) * 100
      );
    }

    this.logger.debug(`Run progress updated: ${runId}`, run.progress);
  }

  /**
   * 完成运行
   */
  async completeRun(runId: string, output?: Run['output'], error?: Run['error']): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    run.endTime = new Date();
    run.status = error ? RunStatus.FAILED : RunStatus.COMPLETED;
    
    if (output) {
      run.output = output;
    }
    
    if (error) {
      run.error = error;
    }

    // 更新任务状态
    const taskStatus = error ? TaskStatus.FAILED : TaskStatus.COMPLETED;
    await this.updateTaskStatus(run.taskId, taskStatus);

    const duration = run.endTime.getTime() - run.startTime.getTime();
    this.logger.info(`Run completed: ${runId} (${duration}ms)`, {
      taskId: run.taskId,
      status: run.status,
      duration
    });
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 取消活跃的运行
    const activeRuns = Array.from(this.runs.values())
      .filter(run => run.taskId === taskId && 
        [RunStatus.INITIALIZING, RunStatus.RUNNING].includes(run.status));

    for (const run of activeRuns) {
      run.status = RunStatus.CANCELLED;
      run.endTime = new Date();
      if (reason) {
        run.error = {
          code: 'CANCELLED',
          message: reason,
          recoverable: false
        };
      }
    }

    await this.updateTaskStatus(taskId, TaskStatus.CANCELLED, { cancelReason: reason });
    
    this.logger.info(`Task cancelled: ${taskId}`, { reason });
  }

  /**
   * 暂停任务
   */
  async pauseTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== TaskStatus.RUNNING) {
      throw new Error(`Task is not running: ${taskId}`);
    }

    await this.updateTaskStatus(taskId, TaskStatus.PAUSED);
    
    // 暂停相关运行
    const activeRuns = Array.from(this.runs.values())
      .filter(run => run.taskId === taskId && run.status === RunStatus.RUNNING);

    for (const run of activeRuns) {
      run.status = RunStatus.PAUSED;
    }

    this.logger.info(`Task paused: ${taskId}`);
  }

  /**
   * 恢复任务
   */
  async resumeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== TaskStatus.PAUSED) {
      throw new Error(`Task is not paused: ${taskId}`);
    }

    await this.updateTaskStatus(taskId, TaskStatus.RUNNING);
    
    // 恢复相关运行
    const pausedRuns = Array.from(this.runs.values())
      .filter(run => run.taskId === taskId && run.status === RunStatus.PAUSED);

    for (const run of pausedRuns) {
      run.status = RunStatus.RUNNING;
    }

    this.logger.info(`Task resumed: ${taskId}`);
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 如果任务正在运行，先取消
    if ([TaskStatus.RUNNING, TaskStatus.PAUSED].includes(task.status)) {
      await this.cancelTask(taskId, 'Task deleted');
    }

    // 删除相关运行记录
    const taskRuns = Array.from(this.runs.entries())
      .filter(([, run]) => run.taskId === taskId);
    
    for (const [runId] of taskRuns) {
      this.runs.delete(runId);
    }

    this.tasks.delete(taskId);
    this.activeTasks.delete(taskId);
    
    this.logger.info(`Task deleted: ${taskId}`);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalTasks: number;
    activeTasks: number;
    tasksByStatus: Record<string, number>;
    runsByStatus: Record<string, number>;
    averageExecutionTime: number;
  } {
    const tasksByStatus: Record<string, number> = {};
    const runsByStatus: Record<string, number> = {};
    let totalExecutionTime = 0;
    let completedRuns = 0;

    // 统计任务状态
    Array.from(this.tasks.values()).forEach(task => {
      tasksByStatus[task.status] = (tasksByStatus[task.status] || 0) + 1;
    });

    // 统计运行状态和执行时间
    Array.from(this.runs.values()).forEach(run => {
      runsByStatus[run.status] = (runsByStatus[run.status] || 0) + 1;
      
      if (run.endTime && run.status === RunStatus.COMPLETED) {
        totalExecutionTime += run.endTime.getTime() - run.startTime.getTime();
        completedRuns++;
      }
    });

    const averageExecutionTime = completedRuns > 0 ? totalExecutionTime / completedRuns : 0;

    return {
      totalTasks: this.tasks.size,
      activeTasks: this.activeTasks.size,
      tasksByStatus,
      runsByStatus,
      averageExecutionTime
    };
  }

  /**
   * 清理已完成的任务
   */
  async cleanup(olderThan?: Date): Promise<number> {
    const cutoffTime = olderThan || new Date(Date.now() - 24 * 60 * 60 * 1000); // 24小时前
    let cleanedCount = 0;

    const tasksToClean = Array.from(this.tasks.entries())
      .filter(([, task]) => 
        [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(task.status) &&
        task.updatedAt < cutoffTime
      );

    for (const [taskId] of tasksToClean) {
      await this.deleteTask(taskId);
      cleanedCount++;
    }

    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} old tasks`);
    }

    return cleanedCount;
  }

  /**
   * 销毁任务管理器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // 取消所有活跃任务
    Array.from(this.activeTasks).forEach(taskId => {
      this.cancelTask(taskId, 'TaskManager destroyed').catch(err => {
        this.logger.error('Error cancelling task during destroy', err);
      });
    });

    this.tasks.clear();
    this.runs.clear();
    this.activeTasks.clear();
    
    this.logger.info('TaskManager destroyed');
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 开始自动清理
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(err => {
        this.logger.error('Auto cleanup failed', err);
      });
    }, this.config.cleanupIntervalMs);
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听错误事件，自动处理任务失败
    this.eventBus.subscribe(EventType.ERROR, async (event) => {
      if (event.data?.stepId) {
        // 查找相关的运行记录
        const run = Array.from(this.runs.values())
          .find(r => r.status === RunStatus.RUNNING);
        
        if (run) {
          await this.completeRun(run.runId, undefined, {
            code: event.data.code || 'UNKNOWN_ERROR',
            message: event.data.message || 'Unknown error occurred',
            stepId: event.data.stepId,
            recoverable: event.data.recoverable || false
          });
        }
      }
    });
  }
}

// 默认任务管理器实例
let defaultTaskManager: TaskManager | null = null;

export function getDefaultTaskManager(): TaskManager {
  if (!defaultTaskManager) {
    defaultTaskManager = new TaskManager();
  }
  return defaultTaskManager;
}

export function setDefaultTaskManager(taskManager: TaskManager): void {
  defaultTaskManager = taskManager;
}