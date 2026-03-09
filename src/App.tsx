import React, { useState, useCallback } from 'react';
import { Shield, Upload, Key, CheckCircle, AlertTriangle, Loader2, FileText, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

interface VerificationResult {
  document_info: {
    type: string;
    document_number: string;
    full_name: string;
    nationality: string;
    expiry_date: string;
  };
  security_analysis: {
    mrz_matched: boolean;
    is_expired: boolean;
    fraud_risk_level: 'Low' | 'Medium' | 'High';
  };
}

interface CompanyInfo {
  name: string;
  subscription_plan: string;
  usage_count: number;
}

export default function App() {
  const [apiKey, setApiKey] = useState('mawthooq_test_key_123');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const fetchCompanyInfo = async () => {
    try {
      const res = await fetch(`/api/company-info?apiKey=${apiKey}`);
      if (res.ok) {
        const data = await res.json();
        setCompanyInfo(data);
      }
    } catch (err) {
      console.error("Failed to fetch company info", err);
    }
  };

  const handleChat = async () => {
    if (!chatInput || !result) return;

    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `أنت مساعد ذكي لنظام "مَوثوق". لديك البيانات التالية المستخرجة من مستند: ${JSON.stringify(result)}. أجب على سؤال المستخدم باختصار ومهنية: ${userMsg}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });

      setChatMessages(prev => [...prev, { role: 'ai', text: response.text || 'عذراً، لم أتمكن من معالجة طلبك.' }]);
    } catch (err) {
      console.error("Chat Error:", err);
      setChatMessages(prev => [...prev, { role: 'ai', text: 'حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (selectedFile.size > maxSize) {
        setError('حجم الملف كبير جداً. الحد الأقصى المسموح به هو 5 ميجابايت.');
        setFile(null);
        return;
      }

      setFile(selectedFile);
      setError(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleVerify = async () => {
    if (!file || !apiKey) {
      setError('يرجى إدخال مفتاح API ورفع صورة المستند');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // 1. Verify API Key with backend first (optional but good for usage tracking)
      const checkRes = await fetch(`/api/company-info?apiKey=${apiKey}`);
      if (!checkRes.ok) {
        if (checkRes.status === 404 || checkRes.status === 403 || checkRes.status === 401) {
          throw new Error('مفتاح API غير صالح: المفتاح المدخل غير موجود في سجلاتنا. يرجى التحقق من بيانات الاعتماد الخاصة بك.');
        }
        const errData = await checkRes.json().catch(() => ({}));
        throw new Error(errData.error || 'مفتاح API غير صالح');
      }

      // 2. Call Gemini API from Frontend
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const base64Data = await fileToBase64(file);

      const prompt = `أنت خبير أمني متخصص في فحص المستندات الرسمية. استخرج البيانات الأساسية (الاسم، رقم المستند، الجنسية، تاريخ الميلاد، الانتهاء). قم بمقاطعة شريط الـ (MRZ) مع البيانات المطبوعة لاكتشاف التزوير. أعد الاستجابة فقط بتنسيق JSON كالتالي:
      {
        "document_info": {"type": "", "document_number": "", "full_name": "", "nationality": "", "expiry_date": ""},
        "security_analysis": {"mrz_matched": true, "is_expired": false, "fraud_risk_level": "Low/Medium/High"}
      }`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
        }
      });

      const data = JSON.parse(response.text || "{}");
      setResult(data);

      // 3. Log verification in backend
      const logRes = await fetch('/api/log-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          documentType: data.document_info?.type,
          status: data.security_analysis?.fraud_risk_level === 'High' ? 'Flagged' : 'Verified'
        }),
      });

      if (!logRes.ok) {
        console.warn('Failed to log verification, but processing continued.');
      }

      fetchCompanyInfo();
    } catch (err: any) {
      console.error("Verification Error:", err);
      if (err instanceof TypeError || err.name === 'TypeError' || err.message?.includes('fetch')) {
        setError('خطأ في الشبكة: تعذر الوصول إلى الخادم. يرجى التحقق من اتصالك بالإنترنت.');
      } else {
        setError(err.message || 'فشل التحقق من المستند');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 py-6 px-8">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Shield className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">مَوثوق</h1>
              <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Mawthooq Verification System</p>
            </div>
          </div>
          
          {companyInfo && (
            <div className="hidden md:flex items-center gap-6 text-sm">
              <div className="flex flex-col items-end">
                <span className="text-slate-400 text-[10px] uppercase font-bold">الشركة</span>
                <span className="font-semibold">{companyInfo.name}</span>
              </div>
              <div className="h-8 w-px bg-slate-200"></div>
              <div className="flex flex-col items-end">
                <span className="text-slate-400 text-[10px] uppercase font-bold">الخطة</span>
                <span className="font-semibold text-emerald-600">{companyInfo.subscription_plan}</span>
              </div>
              <div className="h-8 w-px bg-slate-200"></div>
              <div className="flex flex-col items-end">
                <span className="text-slate-400 text-[10px] uppercase font-bold">العمليات</span>
                <span className="font-semibold">{companyInfo.usage_count}</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Controls */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-emerald-600" />
              إعدادات الوصول
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  placeholder="أدخل مفتاح API الخاص بك"
                />
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-600" />
              رفع المستند
            </h2>
            
            <div 
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer
                ${file ? 'border-emerald-500 bg-emerald-50/30' : 'border-slate-200 hover:border-emerald-400 bg-slate-50'}`}
              onClick={() => document.getElementById('fileInput')?.click()}
            >
              <input 
                id="fileInput"
                type="file" 
                className="hidden" 
                accept="image/*"
                onChange={handleFileChange}
              />
              {file ? (
                <div className="text-center">
                  <FileText className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-700">{file.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-500">اسحب صورة المستند هنا أو اضغط للرفع</p>
                  <p className="text-xs text-slate-400 mt-1">يدعم JPG, PNG (بحد أقصى 5MB)</p>
                </div>
              )}
            </div>

            <button
              onClick={handleVerify}
              disabled={loading || !file}
              className={`w-full mt-6 py-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2
                ${loading || !file ? 'bg-slate-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20'}`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري التحليل...
                </>
              ) : (
                <>
                  <Activity className="w-5 h-5" />
                  بدء التحقق الذكي
                </>
              )}
            </button>

            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-600 font-medium">{error}</p>
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {/* Security Status Card */}
                <div className={`rounded-2xl p-6 border flex items-center justify-between
                  ${result.security_analysis.fraud_risk_level === 'Low' 
                    ? 'bg-emerald-50 border-emerald-100' 
                    : result.security_analysis.fraud_risk_level === 'Medium'
                    ? 'bg-amber-50 border-amber-100'
                    : 'bg-red-50 border-red-100'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full 
                      ${result.security_analysis.fraud_risk_level === 'Low' ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                      {result.security_analysis.fraud_risk_level === 'Low' ? (
                        <CheckCircle className="text-white w-8 h-8" />
                      ) : (
                        <AlertTriangle className="text-white w-8 h-8" />
                      )}
                    </div>
                    <div>
                      <h3 className={`text-xl font-bold 
                        ${result.security_analysis.fraud_risk_level === 'Low' ? 'text-emerald-900' : 'text-amber-900'}`}>
                        {result.security_analysis.fraud_risk_level === 'Low' ? 'مستند موثوق' : 'تنبيه أمني'}
                      </h3>
                      <p className={`text-sm font-medium
                        ${result.security_analysis.fraud_risk_level === 'Low' ? 'text-emerald-700' : 'text-amber-700'}`}>
                        مستوى مخاطر الاحتيال: {result.security_analysis.fraud_risk_level}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">الحالة</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold
                      ${result.security_analysis.fraud_risk_level === 'Low' ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'}`}>
                      {result.security_analysis.fraud_risk_level === 'Low' ? 'VERIFIED' : 'REVIEW REQUIRED'}
                    </span>
                  </div>
                </div>

                {/* Data Grid */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-bold text-slate-700">البيانات المستخرجة</h3>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <DataField label="الاسم الكامل" value={result.document_info.full_name} />
                    <DataField label="نوع المستند" value={result.document_info.type} />
                    <DataField label="رقم المستند" value={result.document_info.document_number} />
                    <DataField label="الجنسية" value={result.document_info.nationality} />
                    <DataField label="تاريخ الانتهاء" value={result.document_info.expiry_date} />
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">مطابقة MRZ</span>
                      <div className="flex items-center gap-2">
                        {result.security_analysis.mrz_matched ? (
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                        <span className={`text-sm font-semibold ${result.security_analysis.mrz_matched ? 'text-emerald-600' : 'text-red-600'}`}>
                          {result.security_analysis.mrz_matched ? 'مطابق' : 'غير مطابق'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Raw JSON for developers */}
                <div className="bg-slate-900 rounded-2xl p-6 shadow-xl">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Raw Response (JSON)</span>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    </div>
                  </div>
                  <pre className="text-xs text-emerald-400 font-mono overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>

                {/* AI Assistant Chat */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-emerald-50/50 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    <h3 className="font-bold text-slate-700">مساعد مَوثوق الذكي</h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="h-48 overflow-y-auto space-y-3 p-2 bg-slate-50 rounded-xl border border-slate-100">
                      {chatMessages.length === 0 && (
                        <p className="text-xs text-slate-400 text-center mt-16">اسأل أي سؤال حول هذا المستند...</p>
                      )}
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                            msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                          }`}>
                            {msg.text}
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="flex justify-start">
                          <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm">
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleChat()}
                        placeholder="اسأل عن صلاحية المستند، العمر، أو أي تفاصيل أخرى..."
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                      <button
                        onClick={handleChat}
                        disabled={chatLoading || !chatInput}
                        className="bg-emerald-600 text-white p-2 rounded-xl hover:bg-emerald-700 disabled:bg-slate-300 transition-colors"
                      >
                        <Activity className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[400px] border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <Shield className="w-16 h-16 mb-4 opacity-20" />
                <h3 className="text-lg font-semibold">بانتظار التحقق</h3>
                <p className="max-w-xs text-sm mt-2">قم برفع صورة جواز سفر أو هوية للبدء في عملية الفحص الأمني واستخراج البيانات</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto p-8 text-center text-slate-400 text-xs">
        <p>© 2024 مَوثوق - جميع الحقوق محفوظة. نظام مدعوم بالذكاء الاصطناعي للفحص الأمني.</p>
      </footer>
    </div>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value || '---'}</span>
    </div>
  );
}
