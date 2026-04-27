# backend/utils/counter.py
import tiktoken

def estimate_tokens(history: list, model_encoding="cl100k_base"):
    """
    估計對話歷史中的總 Token 數 [cite: 18]。
    """
    encoding = tiktoken.get_encoding(model_encoding)
    num_tokens = 0
    for message in history:
        num_tokens += len(encoding.encode(message["content"]))
    return num_tokens