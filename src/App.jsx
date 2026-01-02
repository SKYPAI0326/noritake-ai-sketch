import React, { useState, useRef, useEffect } from 'react';
import { 
  Copy, Image as ImageIcon, Wand2, Loader2, RefreshCw, 
  PenTool, UploadCloud, XCircle, FileImage, Settings, 
  Key, Sparkles, Download, AlertCircle 
} from 'lucide-react';

// 系統預設的 API Key (執行環境會自動填入，本地執行請在下方引號填入或使用環境變數)
const apiKey = "";

export default function App() {
  // 除錯用：確認元件是否掛載
  useEffect(() => {
    console.log("App component mounted successfully");
  }, []);

  // 輸入狀態管理
  const [inputs, setInputs] = useState({
    character: '',
    action: '',
    outfit: '',
    environment: '',
    finetuning: ''
  });

  // API Key 管理
  const [userApiKey, setUserApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // 圖片上傳狀態
  const [uploadedImage, setUploadedImage] = useState(null); // Display purpose
  const [analyzableImageBase64, setAnalyzableImageBase64] = useState(''); // Compressed Base64 for API
  const [imageMimeType, setImageMimeType] = useState('');
  const fileInputRef = useRef(null); 

  // 應用程式狀態
  const [status, setStatus] = useState('idle'); // idle, analyzing, generating_image, done, error
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // 處理輸入變更
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputs(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // 圖片壓縮工具函數
  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxSize = 1024; 

        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width *= maxSize / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error("Canvas context failed"));
            return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL(file.type || 'image/jpeg', 0.8);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = (err) => reject(err);
    });
  };

  // 處理圖片上傳
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]; // Optional chaining for safety
    if (file) {
      setUploadedImage(file);
      setImageMimeType(file.type || "image/png");
      
      try {
        const compressedBase64 = await compressImage(file);
        setAnalyzableImageBase64(compressedBase64);
      } catch (err) {
        console.error("Image compression failed", err);
        setErrorMessage("圖片處理失敗，請嘗試其他圖片");
      }
    }
  };

  // 清除上傳的圖片
  const clearUploadedImage = () => {
    setUploadedImage(null);
    setAnalyzableImageBase64('');
    setImageMimeType('');
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; 
    }
  };

  // 複製提示詞
  const copyToClipboard = () => {
    if (!generatedPrompt) return;
    navigator.clipboard.writeText(generatedPrompt).then(() => {
       // Optional toast
    }).catch(err => {
        console.error('Failed to copy', err);
    });
  };

  // 下載圖片
  const downloadImage = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `noritake-sketch-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 帶有重試機制的 Fetch
  const fetchWithBackoff = async (url, options, retries = 3, delay = 1000) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok && (response.status === 429 || response.status >= 500)) {
        throw new Error(`Retryable API Error: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithBackoff(url, options, retries - 1, delay * 2);
      }
      throw error;
    }
  };

  // 安全的 API 請求處理
  const safeFetchJson = async (url, options) => {
    const response = await fetchWithBackoff(url, options);
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("API Key 無效 (401)。請檢查設定。");
        }
        throw new Error(data.error?.message || `API Error: ${response.status}`);
      }
      return data;
    } catch (e) {
      if (e.message && e.message.includes("API Key")) throw e;
      if (!response.ok) throw new Error(`API Error (${response.status}): ${text}`);
      throw new Error("Invalid JSON response");
    }
  };

  // 核心生成邏輯
  const handleGenerate = async () => {
    const effectiveKey = userApiKey || apiKey;

    if (!effectiveKey) {
      setErrorMessage("未偵測到 API Key。請點擊右上角設定圖示輸入。");
      setShowSettings(true);
      return;
    }

    if (!inputs.character && !inputs.action && !analyzableImageBase64) {
      setErrorMessage("請至少輸入人物描述或上傳一張參考圖片。");
      return;
    }

    setStatus('analyzing');
    setErrorMessage('');
    setGeneratedImage('');
    setGeneratedPrompt('');

    try {
      let promptTemplate = '';
      let geminiPayloadParts = [];

      const styleDefinition = `
        Style Guidelines (Noritake-style / Japanese Minimalist):
        - **Aesthetic**: Japanese minimalist illustration style (like Noritake or Yu Nagaba).
        - **Features**: Soft, round, and simple facial features. Avoid sharp, realistic, or Western comic book features.
        - **Monoline**: Use a single, consistent, thin black line weight.
        - **Flat**: Absolutely NO shading, NO gradients, NO shadows, NO texture.
        - **Minimalist**: Simplify complex shapes into basic curves. Eliminate unnecessary details (like shoe laces, detailed fingers, clothing folds).
        - **Expression**: Faces should be blank or extremely subtle (dots for eyes, small line for mouth). Deadpan emotion.
        - **Composition**: Extensive white space (negative space). Subject is isolated.
        - **Color**: STRICTLY Black and White only.
      `;

      if (analyzableImageBase64) {
        // 模式 A: 有參考圖
        promptTemplate = `
          Role: Minimalist Art Director.
          Task:
          1. Analyze the image for: Subject (gender/age), Pose/Action, and Outfit.
          2. **User Override**: If User Inputs (Chinese) below are provided, they take priority over image details.
          3. **Transformation**: Rewrite the visual description into a precise prompt for the defined style.
          
          ${styleDefinition}
          
          User Inputs (Chinese):
          - Character: ${inputs.character || '(Follow image)'}
          - Action: ${inputs.action || '(Follow image)'}
          - Outfit: ${inputs.outfit || '(Follow image)'}
          - Environment: ${inputs.environment || '(Follow image)'}
          - Fine-tuning: ${inputs.finetuning || 'None'}

          Output Format:
          Output ONLY the final English prompt string.
          Structure: "A Japanese minimalist line art illustration in the style of Noritake of [Subject], [Action], wearing [Outfit], in [Environment]. [Style Keywords: flat, vector lines, no shading, generous whitespace, confident thin strokes, Japanese magazine style, soft features]."
        `;
        
        geminiPayloadParts = [
          { text: promptTemplate },
          { inlineData: { mimeType: imageMimeType || "image/png", data: analyzableImageBase64 } }
        ];

      } else {
        // 模式 B: 純文字
        promptTemplate = `
          Role: Minimalist Art Director.
          Task:
          1. Translate User Inputs (Chinese) to English.
          2. Convert them into a precise prompt following the style guidelines.
          
          ${styleDefinition}
          
          User Inputs:
          - Character: ${inputs.character || 'A generic figure'}
          - Action: ${inputs.action || 'standing'}
          - Outfit: ${inputs.outfit || 'simple casual wear'}
          - Environment: ${inputs.environment || 'empty white background'}
          - Fine-tuning: ${inputs.finetuning || 'None'}

          Output Format:
          Output ONLY the final English prompt string.
          Structure: "A Japanese minimalist line art illustration in the style of Noritake of [Subject], [Action], wearing [Outfit], in [Environment]. [Style Keywords: flat, vector lines, no shading, generous whitespace, confident thin strokes, Japanese magazine style, soft features]."
        `;
        geminiPayloadParts = [{ text: promptTemplate }];
      }

      // Gemini Call
      const geminiData = await safeFetchJson(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${effectiveKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: "user", parts: geminiPayloadParts }] })
      });

      const finalPrompt = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!finalPrompt) throw new Error('無法生成提示詞');
      setGeneratedPrompt(finalPrompt);
      setStatus('generating_image');

      // Imagen Call
      const imagenData = await safeFetchJson(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${effectiveKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: finalPrompt }],
          parameters: { sampleCount: 1, aspectRatio: "3:4" }
        })
      });
      
      const base64Image = imagenData.predictions?.[0]?.bytesBase64Encoded;
      if (base64Image) {
        setGeneratedImage(`data:image/png;base64,${base64Image}`);
      } else {
        throw new Error('未收到圖像數據');
      }

      setStatus('done');

    } catch (error) {
      console.error("Error:", error);
      setErrorMessage(error.message || "發生未知錯誤");
      setStatus('error');
      if (error.message && error.message.includes("401")) setShowSettings(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-[1400px] mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
        
        {/* Header */}
        <header className="bg-slate-900 text-white p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PenTool className="w-8 h-8 text-yellow-400" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Noritake Style AI Sketch v2.0</h1>
              <p className="text-slate-400 text-sm">增強版：更精準的風格控制與壓縮引擎</p>
            </div>
          </div>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            <Settings className="w-6 h-6" />
          </button>
        </header>

        {/* API Settings */}
        {showSettings && (
          <div className="bg-slate-800 p-4 border-b border-slate-700 animate-in slide-in-from-top-2">
            <div className="max-w-3xl mx-auto">
              <label className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-2">
                <Key className="w-3 h-3" /> API Key 設定
              </label>
              <div className="flex gap-2">
                <input 
                  type="password" 
                  value={userApiKey}
                  onChange={(e) => setUserApiKey(e.target.value)}
                  placeholder="輸入您的 Google Gemini API Key"
                  className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-600 text-white text-sm focus:ring-yellow-400 outline-none"
                />
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-slate-600 text-white text-sm rounded hover:bg-slate-500"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          
          {/* Left: Inputs */}
          <div className="space-y-6">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800 mb-6 flex gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-bold mb-1">使用說明</p>
                上傳照片後，AI 會自動捕捉動作與特徵。您可以在下方欄位輸入文字來覆蓋特定細節（例如：把「短髮」改為「長髮」）。
              </div>
            </div>

            {/* Image Upload */}
            <div className="bg-slate-100 p-4 rounded-lg border border-slate-200">
              <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                <FileImage className="w-4 h-4" /> 參考圖片 (將自動壓縮以加速處理)
              </label>
              {!uploadedImage ? (
                <div
                  className="flex items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-white hover:bg-blue-50 hover:border-blue-400 transition-all"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex flex-col items-center">
                    <UploadCloud className="w-10 h-10 mb-2 text-slate-400" />
                    <p className="text-sm text-slate-500">點擊上傳圖片</p>
                    <p className="text-xs text-slate-400">支援 JPG, PNG (自動優化)</p>
                  </div>
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </div>
              ) : (
                <div className="relative w-full h-40 border border-slate-300 rounded-lg overflow-hidden group bg-white">
                  <img src={URL.createObjectURL(uploadedImage)} alt="Preview" className="w-full h-full object-contain" />
                  <button
                    onClick={clearUploadedImage}
                    className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-md"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
            
            <div className="space-y-4">
              {[
                { label: '人物角色', name: 'character', placeholder: '例：戴帽子的女孩' },
                { label: '人物行為', name: 'action', placeholder: '例：正在喝咖啡' },
                { label: '人物裝飾', name: 'outfit', placeholder: '例：寬鬆的毛衣' },
                { label: '背景環境', name: 'environment', placeholder: '例：簡單的線條桌子' },
              ].map((field) => (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{field.label}</label>
                  <input
                    type="text"
                    name={field.name}
                    value={inputs[field.name]}
                    onChange={handleInputChange}
                    placeholder={field.placeholder}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Right: Output */}
          <div className="flex flex-col gap-6">
            
            {/* Fine-tuning */}
            <div className="bg-white p-5 rounded-xl border border-purple-100 shadow-sm ring-1 ring-purple-50">
                <div className="flex items-center gap-2 mb-3 text-purple-700">
                    <Sparkles className="w-5 h-5" />
                    <span className="font-bold text-sm">微調與執行</span>
                </div>
                <textarea
                  name="finetuning"
                  value={inputs.finetuning}
                  onChange={handleInputChange}
                  rows="2"
                  placeholder="額外指令：例如「線條更少一點」、「不要畫鞋子」..."
                  className="w-full px-4 py-2 rounded-lg border border-purple-200 bg-purple-50/50 focus:ring-2 focus:ring-purple-500 outline-none transition-all text-sm"
                />
                
                <button
                  onClick={handleGenerate}
                  disabled={status === 'analyzing' || status === 'generating_image'}
                  className={`w-full mt-4 py-3 px-6 rounded-xl font-bold text-lg text-white shadow-lg transform transition-all active:scale-[0.98] flex items-center justify-center gap-3
                      ${(status === 'analyzing' || status === 'generating_image')
                      ? 'bg-slate-400 cursor-not-allowed shadow-none' 
                      : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'}`}
                >
                  {status === 'analyzing' && <><Loader2 className="animate-spin" /> 分析畫面結構...</>}
                  {status === 'generating_image' && <><Loader2 className="animate-spin" /> 繪製插圖中...</>}
                  {status === 'idle' && <><Wand2 className="w-5 h-5" /> 生成插圖 (Generate)</>}
                  {(status === 'done' || status === 'error') && <><RefreshCw className="w-5 h-5" /> 重新生成</>}
                </button>

                {errorMessage && (
                    <div className="mt-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-200 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" /> {errorMessage}
                    </div>
                )}
            </div>

            {/* Result Area */}
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 flex flex-col flex-1 min-h-[450px]">
              
              {/* Prompt Box */}
              <div className="mb-4">
                <div className="flex justify-between items-end mb-2">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI Generated Prompt</h3>
                  {generatedPrompt && (
                    <button onClick={copyToClipboard} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
                      <Copy className="w-3 h-3" /> 複製
                    </button>
                  )}
                </div>
                <div className="bg-white p-3 rounded-lg text-xs font-mono text-slate-600 border border-slate-200 h-20 overflow-y-auto leading-relaxed">
                  {generatedPrompt || "等待生成..."}
                </div>
              </div>

              {/* Image Box */}
              <div className="flex-1 flex flex-col">
                <div className={`flex-1 rounded-xl border-2 transition-all flex items-center justify-center overflow-hidden bg-white relative min-h-[300px]
                  ${generatedImage ? 'border-slate-200 border-solid' : 'border-slate-300 border-dashed'}`}>
                  
                  {status === 'generating_image' ? (
                     <div className="text-center text-slate-500 animate-pulse">
                       <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-indigo-500" />
                       <p className="text-sm font-medium">正在模擬墨水筆觸...</p>
                     </div>
                  ) : status === 'analyzing' ? (
                    <div className="text-center text-slate-500 animate-pulse">
                      <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-blue-500" />
                      <p className="text-sm font-medium">正在解析圖片內容...</p>
                    </div>
                  ) : generatedImage ? (
                    <img 
                      src={generatedImage} 
                      alt="Result" 
                      className="w-full h-full object-contain p-4" 
                    />
                  ) : (
                    <div className="text-center text-slate-400">
                      <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">成品將顯示於此</p>
                    </div>
                  )}
                </div>
                
                {generatedImage && (
                  <button
                    onClick={downloadImage}
                    className="mt-4 w-full py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                  >
                    <Download className="w-4 h-4" /> 下載圖片
                  </button>
                )}
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}