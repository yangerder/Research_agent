import sounddevice as sd
import numpy as np
import time

# --- 模擬 config.py 的設定 ---
VAD_THRESHOLD = 0.05  # 你原本設定的門檻
SILENCE_TIMEOUT = 0.5  # Scenario A 的 0.5 秒
SAMPLE_RATE = 16000    # 取樣率
CHANNELS = 1           # 單聲道

class VADTester:
    def __init__(self):
        self.silence_start = None
        self.is_silent = False

    def audio_callback(self, indata, frames, time_info, status):
        if status:
            print(status)
        
        # 計算均方根音量 (RMS)
        # $$RMS = \sqrt{\text{mean}(x^2)}$$
        rms = np.sqrt(np.mean(indata**2))
        
        # 建立一個簡單的文字能量條
        meter = "█" * int(rms * 500)
        
        if rms < VAD_THRESHOLD:
            if self.silence_start is None:
                self.silence_start = time.time()
            
            duration = time.time() - self.silence_start
            
            if duration >= SILENCE_TIMEOUT:
                status_text = f"🔴 [中斷成功] 靜音已達 {duration:.2f}s"
            else:
                status_text = f"🤫 偵測到靜音 ({duration:.2f}s)"
        else:
            self.silence_start = None
            status_text = "🗣️ 偵測到人聲"

        # 使用 \r 讓終端機只更新同一行
        print(f"\rRMS: {rms:.4f} | {meter:<50} | {status_text}", end="", flush=True)

    def run(self):
        print(f"🚀 開始 VAD 測試 (門檻: {VAD_THRESHOLD}, 超時: {SILENCE_TIMEOUT}s)")
        print("按 Ctrl+C 停止測試\n")
        
        with sd.InputStream(callback=self.audio_callback,
                            channels=CHANNELS,
                            samplerate=SAMPLE_RATE):
            while True:
                time.sleep(0.1)

if __name__ == "__main__":
    tester = VADTester()
    try:
        tester.run()
    except KeyboardInterrupt:
        print("\n\n測試結束。")