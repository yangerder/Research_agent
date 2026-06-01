import subprocess
import time
import sys
import os
import signal
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"

BACKEND_URL = "http://localhost:8000"
FRONTEND_URL = "http://localhost:3000"


def wait_for_service(url: str, name: str, timeout: int = 60):
    print(f"⏳ 等待 {name} 啟動：{url}")

    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status < 500:
                    print(f"✅ {name} 已啟動")
                    return
        except Exception:
            time.sleep(1)

    raise RuntimeError(f"{name} 啟動逾時：{url}")


def terminate_process(process: subprocess.Popen, name: str):
    if process.poll() is not None:
        return

    print(f"🛑 正在停止 {name}...")

    try:
        if os.name == "nt":
            # Windows：連同 uvicorn / next 子程序一起關掉
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except Exception as e:
        print(f"⚠️ 停止 {name} 時發生問題：{e}")


def run():
    print("🚀 正在啟動 GenAI 實驗系統...")

    backend_process = None
    frontend_process = None

    try:
        # 1. 啟動後端 FastAPI
        print("🚀 啟動後端 FastAPI...")

        backend_process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--reload",
                "--host",
                "0.0.0.0",
                "--port",
                "8000",
            ],
            cwd=str(BACKEND_DIR),
        )

        wait_for_service(f"{BACKEND_URL}/config", "後端 FastAPI")

        # 2. 啟動前端 Next.js
        print("🚀 啟動前端 Next.js...")

        frontend_env = os.environ.copy()
        frontend_env["NEXT_PUBLIC_API_BASE"] = BACKEND_URL

        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"

        frontend_process = subprocess.Popen(
            [npm_cmd, "run", "dev"],
            cwd=str(FRONTEND_DIR),
            env=frontend_env,
        )

        wait_for_service(FRONTEND_URL, "前端 Next.js")

        print("")
        print("====================================")
        print("✅ GenAI 實驗系統已啟動")
        print("====================================")
        print(f"後端：{BACKEND_URL}")
        print(f"前端：{FRONTEND_URL}")
        print("")
        print("請打開：")
        print(FRONTEND_URL)
        print("")
        print("按 Ctrl + C 可以停止系統。")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n🛑 收到停止訊號")

    except Exception as e:
        print(f"\n❌ 啟動失敗：{e}")

    finally:
        if frontend_process:
            terminate_process(frontend_process, "前端")
        if backend_process:
            terminate_process(backend_process, "後端")

        print("✅ 系統已停止")


if __name__ == "__main__":
    run()