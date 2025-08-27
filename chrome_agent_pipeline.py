from typing import List, Union, Generator, Iterator
from pydantic import BaseModel
import requests
import json
import re

class Pipeline:
    class Valves(BaseModel):
        chrome_agent_url: str = "http://localhost:3000"
        enable_auto_detection: bool = True
        timeout: int = 30
        
    def __init__(self):
        self.name = "Chrome Agent"
        self.valves = self.Valves()
        
    async def on_startup(self):
        print(f"🚀 Chrome Agent Pipeline 已启动")
        print(f"📡 连接到: {self.valves.chrome_agent_url}")
        
    async def on_shutdown(self):
        print(f"🔌 Chrome Agent Pipeline 已关闭")
        
    def pipe(
        self, user_message: str, model_id: str, messages: List[dict], body: dict
    ) -> Union[str, Generator, Iterator]:
        
        # 检测浏览器自动化关键词
        browser_keywords = [
            "打开网页", "打开网站", "访问", "浏览", "网页", "网站",
            "提取数据", "抓取", "爬取", "获取内容", "截图",
            "点击", "输入", "搜索", "填写表单", "下载",
            "open website", "visit", "browse", "extract", "scrape",
            "click", "input", "search", "screenshot"
        ]
        
        # URL 检测
        url_pattern = r'https?://[^\s]+'
        has_url = bool(re.search(url_pattern, user_message))
        
        # 检测是否为浏览器任务
        is_browser_task = (
            self.valves.enable_auto_detection and 
            (any(keyword in user_message.lower() for keyword in browser_keywords) or has_url)
        )
        
        if is_browser_task:
            return self._execute_browser_task(user_message)
        
        # 非浏览器任务，返回原始消息让其他模型处理
        return user_message
    
    def _execute_browser_task(self, task: str) -> str:
        """执行浏览器自动化任务"""
        try:
            # 提取URL（如果有）
            url_match = re.search(r'https?://[^\s]+', task)
            url = url_match.group(0) if url_match else None
            
            # 判断任务类型
            if any(keyword in task.lower() for keyword in ["提取", "抓取", "获取", "extract", "scrape"]):
                return self._extract_data(task, url)
            else:
                return self._execute_general_task(task, url)
                
        except requests.exceptions.ConnectionError:
            return "❌ 无法连接到 Chrome Agent 服务器，请确保服务正在运行"
        except requests.exceptions.Timeout:
            return "⏱️ 请求超时，任务可能需要更长时间执行"
        except Exception as e:
            return f"❌ 执行失败: {str(e)}"
    
    def _execute_general_task(self, task: str, url: str = None) -> str:
        """执行通用浏览器任务"""
        # 构建完整的任务描述
        full_task = task
        if url:
            full_task = f"访问 {url} 然后 {task}"
            
        payload = {
            "model": "chrome-agent-v1",
            "messages": [
                {"role": "user", "content": full_task}
            ],
            "stream": False
        }
            
        response = requests.post(
            f"{self.valves.chrome_agent_url}/api/v1/chat/completions",
            json=payload,
            timeout=self.valves.timeout
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get("choices") and len(result["choices"]) > 0:
                message = result["choices"][0].get("message", {})
                content = message.get("content", "任务已完成")
                return f"✅ 任务执行完成\n\n{content}"
            else:
                return f"❌ 任务执行失败\n\n响应格式异常"
        else:
            return f"❌ 服务器错误 ({response.status_code}): {response.text}"

    
    def _extract_data(self, task: str, url: str = None) -> str:
        """执行数据提取任务"""
        # 尝试从任务描述中提取选择器
        selector = None
        if "选择器" in task or "selector" in task.lower():
            # 简单的选择器提取逻辑
            selector_match = re.search(r'["\']([^"\']+)["\']', task)
            if selector_match:
                selector = selector_match.group(1)
        
        # 构建数据提取任务描述
        if url:
            extract_task = f"访问 {url} 然后 {task}"
            if selector:
                extract_task += f"，使用选择器: {selector}"
        else:
            extract_task = task
            
        # 使用chat接口执行数据提取
        payload = {
            "model": "chrome-agent-v1",
            "messages": [
                {"role": "user", "content": extract_task}
            ],
            "stream": False
        }
            
        response = requests.post(
            f"{self.valves.chrome_agent_url}/api/v1/chat/completions",
            json=payload,
            timeout=self.valves.timeout
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get("choices") and len(result["choices"]) > 0:
                message = result["choices"][0].get("message", {})
                content = message.get("content", "数据提取完成")
                return f"✅ 数据提取完成\n\n{content}"
            else:
                return f"❌ 数据提取失败\n\n响应格式异常"
        else:
            return f"❌ 服务器错误 ({response.status_code}): {response.text}"