/**
 * Chrome Agent 核心数据类型定义
 * 基于PRD文档中的核心数据结构设计
 */

export interface Task {
  id: string;
  name: string;
  intent: string; // 自然语言指令
  createdAt: Date;
  updatedAt: Date;
  status: TaskStatus;
  userId?: string;
  metadata?: Record<string, any>;
}

export enum TaskStatus {
  PENDING = 'pending',
  PLANNING = 'planning',
  READY = 'ready',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface Plan {
  id: string;
  taskId: string;
  steps: Step[];
  riskLevel: RiskLevel;
  meta: PlanMetadata;
  createdAt: Date;
  estimatedDuration?: number; // 预估执行时间（毫秒）
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface PlanMetadata {
  targetUrl?: string;
  description: string;
  tags: string[];
  warnings: string[];
  requirements: string[];
}

export interface Step {
  id: string;
  planId: string;
  order: number;
  action: ActionType;
  selectorCandidates: SelectorCandidate[];
  params: StepParams;
  waitFor: WaitCondition;
  retries: RetryConfig;
  timeout: number;
  description: string;
  isOptional: boolean;
}

export enum ActionType {
  NAVIGATE = 'navigate',
  CLICK = 'click',
  TYPE = 'type',
  SELECT = 'select',
  SCROLL = 'scroll',
  WAIT = 'wait',
  EXTRACT = 'extract',
  SCREENSHOT = 'screenshot',
  EVALUATE = 'evaluate',
  HOVER = 'hover',
  PRESS_KEY = 'press_key'
}

export interface SelectorCandidate {
  type: SelectorType;
  value: string;
  score: number; // 0-100, 越高越优先
  description: string;
  fallback?: boolean;
}

export enum SelectorType {
  CSS = 'css',
  XPATH = 'xpath',
  TEXT = 'text',
  ARIA_LABEL = 'aria-label',
  ROLE = 'role',
  DATA_TESTID = 'data-testid',
  ID = 'id',
  CLASS = 'class',
  TAG = 'tag',
  NAME = 'name'
}

export interface StepParams {
  text?: string;
  url?: string;
  value?: string;
  key?: string;
  coordinates?: { x: number; y: number };
  options?: Record<string, any>;
}

export interface WaitCondition {
  type: WaitType;
  value?: string | number;
  timeout: number;
}

export enum WaitType {
  ELEMENT = 'element',
  NAVIGATION = 'navigation',
  TIMEOUT = 'timeout',
  FUNCTION = 'function',
  NETWORK_IDLE = 'network_idle'
}

export interface RetryConfig {
  maxAttempts: number;
  delay: number; // 重试间隔（毫秒）
  backoff: boolean; // 是否使用指数退避
}

export interface Run {
  runId: string;
  taskId: string;
  planId: string;
  startTime: Date;
  endTime?: Date;
  status: RunStatus;
  logs: LogEntry[];
  screenshots: string[]; // 截图文件路径
  output?: RunOutput;
  error?: ErrorInfo;
  progress: RunProgress;
}

export enum RunStatus {
  INITIALIZING = 'initializing',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  stepId?: string;
  message: string;
  data?: any;
  duration?: number;
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface RunOutput {
  data?: any[];
  files: string[]; // 导出文件路径
  summary: string;
}

export interface ErrorInfo {
  code: string;
  message: string;
  stepId?: string;
  stack?: string;
  screenshot?: string;
  recoverable: boolean;
}

export interface RunProgress {
  currentStepIndex: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  percentage: number;
}

export interface Template {
  templateId: string;
  name: string;
  description: string;
  plan: Omit<Plan, 'id' | 'taskId' | 'createdAt'>;
  parametersSchema: ParameterSchema[];
  version: string;
  owner: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
}

export interface ParameterSchema {
  name: string;
  type: ParameterType;
  description: string;
  required: boolean;
  defaultValue?: any;
  validation?: ValidationRule[];
}

export enum ParameterType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  URL = 'url',
  EMAIL = 'email',
  ARRAY = 'array',
  OBJECT = 'object'
}

export interface ValidationRule {
  type: ValidationType;
  value: any;
  message: string;
}

export enum ValidationType {
  MIN_LENGTH = 'min_length',
  MAX_LENGTH = 'max_length',
  PATTERN = 'pattern',
  MIN = 'min',
  MAX = 'max',
  REQUIRED = 'required'
}

// 事件系统相关类型
export interface AgentEvent {
  type: EventType;
  timestamp: Date;
  data: any;
  source: string;
}

export enum EventType {
  TASK_CREATED = 'task_created',
  TASK_STARTED = 'task_started',
  TASK_COMPLETED = 'task_completed',
  TASK_FAILED = 'task_failed',
  STEP_STARTED = 'step_started',
  STEP_COMPLETED = 'step_completed',
  STEP_FAILED = 'step_failed',
  PLAN_GENERATED = 'plan_generated',
  SCREENSHOT_TAKEN = 'screenshot_taken',
  DATA_EXTRACTED = 'data_extracted',
  ERROR = 'error',
  RECOVERY_SUCCESS = 'recovery_success',
  RECOVERY_FAILED = 'recovery_failed',
  API_ERROR = 'api.error',
  API_SERVER_STARTED = 'api.server.started',
  API_SERVER_STOPPED = 'api.server.stopped',
  EXECUTOR_INITIALIZED = 'executor.initialized',
  EXECUTOR_STEP_COMPLETED = 'executor.step_completed',
  EXECUTOR_CLOSED = 'executor.closed'
}

// 配置相关类型
export interface AgentConfig {
  puppeteer: PuppeteerConfig;
  storage: StorageConfig;
  logging: LoggingConfig;
  security: SecurityConfig;
  performance: PerformanceConfig;
}

export interface PuppeteerConfig {
  headless: boolean;
  executablePath?: string;
  userDataDir?: string;
  viewport: { width: number; height: number };
  timeout: number;
  args: string[];
}

export interface StorageConfig {
  dataDir: string;
  logsDir: string;
  screenshotsDir: string;
  exportsDir: string;
  encryption: boolean;
  encryptionKey?: string;
}

export interface LoggingConfig {
  level: LogLevel;
  enableScreenshots: boolean;
  enableDetailedLogs: boolean;
  maxLogFiles: number;
  maxLogSize: string;
}

export interface SecurityConfig {
  apiKey?: string;
  rateLimiting: {
    maxConcurrentTasks: number;
    taskTimeoutMs: number;
    stepTimeoutMs: number;
  };
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export interface PerformanceConfig {
  maxConcurrentBrowsers: number;
  browserPoolSize: number;
  memoryLimit: number;
  cpuLimit: number;
}

// 执行结果相关类型
export interface ExecutionResult {
  planId: string;
  success: boolean;
  duration: number;
  stepResults: StepResult[];
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  screenshots: string[];
  finalUrl: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  duration: number;
  timestamp: number;
  screenshots: string[];
  data: any;
  error?: string;
}

// 追加：意图解析相关的核心类型（为 AI-only 流程提供类型定义）
export interface ParsedIntent {
  action: ActionType;
  target?: {
    type: 'element' | 'url' | 'data';
    description: string;
    selectors?: {
      type: SelectorType;
      value: string;
      confidence: number;
    }[];
  };
  parameters?: {
    text?: string;
    url?: string;
    value?: string;
    coordinates?: { x: number; y: number };
    options?: Record<string, any>;
  };
  conditions?: {
    waitFor?: string;
    timeout?: number;
    retries?: number;
  };
  context?: {
    domain?: string;
    pageType?: string;
    userGoal?: string;
  };
  confidence: number;
  alternatives?: ParsedIntent[];
}

export interface IntentPattern {
  id: string;
  pattern: RegExp;
  action: ActionType;
  priority: number;
  extractor: (match: RegExpMatchArray, fullText: string) => Partial<ParsedIntent>;
}