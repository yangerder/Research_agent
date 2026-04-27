import subprocess
import time
import sys

def run():
    print("🚀 正在啟動 GenAI 實驗系統...")

    # 1. 啟動後端 (FastAPI)
    backend_process = subprocess.Popen(
        ["uvicorn", "main:app", "--reload", "--port", "8000"],
        cwd="backend"
    )
    print("✅ 後端伺服器已啟動於 http://localhost:8000")

    # 等待一下確保後端完全啟動
    time.sleep(2)

    # 2. 啟動前端 (Next.js)
    frontend_process = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd="frontend",
        shell=True
    )
    print("✅ 前端介面已啟動於 http://localhost:3000")

    try:
        # 持續運行直到手動停止
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 正在停止系統...")
        backend_process.terminate()
        frontend_process.terminate()
        sys.exit(0)

if __name__ == "__main__":
    run()