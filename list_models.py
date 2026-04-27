import os
from groq import Groq
from dotenv import load_dotenv

# 加載 .env 中的 API Key
load_dotenv()

def list_available_models():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("❌ 錯誤：找不到 GROQ_API_KEY。請確認 .env 檔案位在正確位置。")
        return

    client = Groq(api_key=api_key)

    try:
        # 呼叫 Groq API 獲取模型清單
        models = client.models.list()
        
        print("\n" + "="*70)
        print(f"{'可用模型 ID':<40} | {'提供者':<15} | {'上下文長度'}")
        print("-" * 70)
        
        # 排序讓列表更好讀
        sorted_models = sorted(models.data, key=lambda x: x.id)
        
        for model in sorted_models:
            # 取得 context_window，若無則顯示 N/A
            context = getattr(model, 'context_window', 'N/A')
            owned_by = getattr(model, 'owned_by', 'N/A')
            print(f"{model.id:<40} | {owned_by:<15} | {context}")
            
        print("="*70 + "\n")
        print("💡 提示：請複製上面的「模型 ID」到你的 config.py 中的 MODEL_NAME。")

    except Exception as e:
        print(f"❌ 發生錯誤：{e}")

if __name__ == "__main__":
    list_available_models()