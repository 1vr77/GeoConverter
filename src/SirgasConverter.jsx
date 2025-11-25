import React, { useState, useEffect, useRef } from 'react';
import { MapPin, ArrowRightLeft, Copy, Info, Navigation, Globe, FileText, CheckCircle2, Sparkles, Bot, Loader2, Maximize2, Image as ImageIcon, X, ScanLine } from 'lucide-react';

const SirgasConverter = () => {
    const [mode, setMode] = useState('text'); // 'text', 'decimal', 'dms', 'ai'

    // Decimal State
    const [lat, setLat] = useState('');
    const [lng, setLng] = useState('');

    // DMS State
    const [dmsLat, setDmsLat] = useState({ deg: '', min: '', sec: '', dir: 'S' });
    const [dmsLng, setDmsLng] = useState({ deg: '', min: '', sec: '', dir: 'W' });

    // Text/Smart Input State
    const [textLat, setTextLat] = useState('-09°53\'01,685"');
    const [textLng, setTextLng] = useState('-56°03\'41,074"');

    // AI State
    const [aiInput, setAiInput] = useState('');
    const [aiImage, setAiImage] = useState(null); // Base64 string
    const [aiLoading, setAiLoading] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
    const fileInputRef = useRef(null);

    // Results
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    // Carregar Proj4
    const [proj4Loaded, setProj4Loaded] = useState(false);

    // API Key
    const apiKey = "AIzaSyA0WvtfOGVdH9PI76wQWtEJIsjzt3h7s54";

    useEffect(() => {
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.js";
        script.async = true;
        script.onload = () => {
            console.log("Proj4 carregado");
            setProj4Loaded(true);
            window.proj4.defs("EPSG:4674", "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs");
        };
        document.body.appendChild(script);
        return () => {
            document.body.removeChild(script);
        }
    }, []);

    // --- HELPER: Image Processing ---

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) processFile(file);
    };

    const processFile = (file) => {
        if (!file.type.startsWith('image/')) {
            setError("Por favor, selecione apenas arquivos de imagem.");
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => setAiImage(reader.result);
        reader.readAsDataURL(file);
    };

    const handlePaste = (e) => {
        if (mode !== 'ai') return;
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                processFile(blob);
                e.preventDefault();
            }
        }
    };

    const clearImage = () => {
        setAiImage(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // --- GEMINI API HELPERS ---

    const callGemini = async (prompt, imageBase64 = null, systemInstruction = "") => {
        const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
        const delays = [1000, 2000, 4000, 8000];

        const parts = [{ text: prompt }];
        if (imageBase64) {
            const base64Data = imageBase64.split(',')[1];
            const mimeType = imageBase64.split(';')[0].split(':')[1];
            parts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
        }

        for (let i = 0; i <= delays.length; i++) {
            try {
                const response = await fetch(`${baseUrl}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: parts }],
                        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
                        generationConfig: { responseMimeType: "application/json" }
                    })
                });
                if (!response.ok) throw new Error(`API Error: ${response.status}`);
                return await response.json();
            } catch (err) {
                if (i === delays.length) throw err;
                await new Promise(resolve => setTimeout(resolve, delays[i]));
            }
        }
    };

    const callGeminiText = async (prompt) => {
        const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
        try {
            const response = await fetch(`${baseUrl}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            if (!response.ok) throw new Error(`API Error`);
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "Não foi possível gerar análise.";
        } catch (err) {
            return "Erro ao conectar com a IA.";
        }
    };

    // --- HANDLERS ---

    const handleAiExtraction = async () => {
        if (!aiInput.trim() && !aiImage) {
            setError("Por favor, escreva um texto ou cole uma imagem.");
            return;
        }
        setAiLoading(true);
        setError("");

        try {
            const prompt = `Analise o conteúdo e extraia coordenadas (Latitude/Longitude). Retorne JSON: { "lat": number, "lng": number, "found": boolean }. Converta para decimal.`;
            const result = await callGemini(prompt, aiImage, "Especialista em cartografia.");
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            const jsonResponse = JSON.parse(textResponse);

            if (jsonResponse.found && jsonResponse.lat && jsonResponse.lng) {
                setLat(jsonResponse.lat.toString());
                setLng(jsonResponse.lng.toString());
                setMode('decimal');
                handleConvert(jsonResponse.lat, jsonResponse.lng);
            } else {
                setError("Não foi possível identificar coordenadas.");
            }
        } catch (err) {
            console.error(err);
            setError("Erro ao processar. Tente novamente.");
        } finally {
            setAiLoading(false);
        }
    };

    const handleAiAnalysis = async () => {
        if (!result) return;
        setAiAnalysisLoading(true);
        setAiAnalysis("");
        try {
            const prompt = `Analise Lat ${result.inputDec.lat}, Lng ${result.inputDec.lng} (Brasil). Mini-relatório (PT-PT, max 3 frases): Estado/Município, Bioma, Fuso UTM.`;
            const analysis = await callGeminiText(prompt);
            setAiAnalysis(analysis);
        } catch (err) {
            setAiAnalysis("Erro na análise.");
        } finally {
            setAiAnalysisLoading(false);
        }
    };

    const parseCoordinateString = (str) => {
        if (!str) return NaN;
        let cleanStr = str.trim();
        const regex = /^(-?)\s*(\d+)[°\s]+(\d+)['\s]+(\d+[,.]?\d*)["\s]*/;
        const match = cleanStr.match(regex);
        if (match) {
            const isNegative = match[1] === '-';
            const d = parseFloat(match[2]);
            const m = parseFloat(match[3]);
            const s = parseFloat(match[4].replace(',', '.'));
            let decimal = d + m / 60 + s / 3600;
            if (isNegative) decimal = decimal * -1;
            else {
                const directionMatch = cleanStr.match(/[NSLEWO]$/i);
                if (directionMatch) {
                    const dir = directionMatch[0].toUpperCase();
                    if (dir === 'S' || dir === 'W' || dir === 'O') decimal = decimal * -1;
                }
            }
            return decimal;
        }
        return parseFloat(cleanStr.replace(',', '.'));
    };

    const calculateZone = (longitude) => Math.floor((longitude + 180) / 6) + 1;

    const handleConvert = (overrideLat = null, overrideLng = null) => {
        if (!proj4Loaded) { setError("Carregando sistema..."); return; }
        setError(''); setAiAnalysis('');
        let latitude, longitude;

        if (overrideLat !== null && overrideLng !== null) {
            latitude = parseFloat(overrideLat); longitude = parseFloat(overrideLng);
        } else {
            if (mode === 'decimal') { latitude = parseFloat(lat); longitude = parseFloat(lng); }
            else if (mode === 'dms') {
                const dmsToDec = (d, m, s, dir) => {
                    let val = parseFloat(d) + parseFloat(m) / 60 + parseFloat(s) / 3600;
                    return (dir === 'S' || dir === 'W') ? -val : val;
                };
                latitude = dmsToDec(dmsLat.deg, dmsLat.min, dmsLat.sec, dmsLat.dir);
                longitude = dmsToDec(dmsLng.deg, dmsLng.min, dmsLng.sec, dmsLng.dir);
            } else if (mode === 'text') { latitude = parseCoordinateString(textLat); longitude = parseCoordinateString(textLng); }
            else if (mode === 'ai') return;
        }

        if (isNaN(latitude) || isNaN(longitude)) { setError("Coordenadas inválidas."); return; }
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { setError("Valores fora do limite global."); return; }

        try {
            const zone = calculateZone(longitude);
            const hemisphere = latitude >= 0 ? '+north' : '+south';
            const destProjString = `+proj=utm +zone=${zone} ${hemisphere} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
            const point = window.proj4("EPSG:4674", destProjString, [longitude, latitude]);
            setResult({
                easting: point[0],
                northing: point[1],
                zone: zone,
                hemisphere: latitude >= 0 ? 'Norte' : 'Sul',
                inputDec: { lat: latitude, lng: longitude }
            });
        } catch (e) { console.error(e); setError("Erro de cálculo."); }
    };

    const copyToClipboard = (text) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
    };

    return (
        <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-800 flex flex-col items-center py-8 px-4" onPaste={handlePaste}>

            {/* Container Centralizado Clássico */}
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">

                {/* Header Moderno (Slate/Indigo) */}
                <div className="bg-slate-900 p-6 text-white flex items-center justify-between relative overflow-hidden">
                    {/* Efeito de luz sutil */}
                    <div className="absolute top-0 right-0 p-12 bg-indigo-500 rounded-full blur-[60px] opacity-20 pointer-events-none"></div>

                    <div className="relative z-10">
                        <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
                            <Globe className="w-6 h-6 text-indigo-400" />
                            GeoConverter Pro
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">SIRGAS 2000 & Assistente IA</p>
                    </div>
                    <div className="hidden md:block text-right text-xs relative z-10">
                        <div className="px-3 py-1 bg-white/10 rounded-lg border border-white/10">
                            Elipsoide <span className="text-indigo-300 font-bold">GRS80</span>
                        </div>
                    </div>
                </div>

                {/* Tabs - Formato Clássico no Topo */}
                <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
                    <button onClick={() => setMode('ai')} className={`flex-1 min-w-[100px] p-4 font-medium text-sm transition-colors flex items-center justify-center gap-2 border-b-2 ${mode === 'ai' ? 'border-purple-500 text-purple-700 bg-purple-50' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                        <Sparkles className="w-4 h-4" />
                        Assistente IA
                    </button>
                    <button onClick={() => setMode('text')} className={`flex-1 min-w-[100px] p-4 font-medium text-sm transition-colors flex items-center justify-center gap-2 border-b-2 ${mode === 'text' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                        <FileText className="w-4 h-4" />
                        Texto
                    </button>
                    <button onClick={() => setMode('decimal')} className={`flex-1 min-w-[100px] p-4 font-medium text-sm transition-colors flex items-center justify-center gap-2 border-b-2 ${mode === 'decimal' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                        <Navigation className="w-4 h-4" />
                        Decimal
                    </button>
                    <button onClick={() => setMode('dms')} className={`flex-1 min-w-[100px] p-4 font-medium text-sm transition-colors flex items-center justify-center gap-2 border-b-2 ${mode === 'dms' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                        <MapPin className="w-4 h-4" />
                        GMS
                    </button>
                </div>

                <div className="p-6 space-y-6">

                    {/* Input Area */}
                    <div className="space-y-4">

                        {/* INPUT MODE: AI (Purple Theme) */}
                        {mode === 'ai' && (
                            <div className="animate-in fade-in duration-300 space-y-4">
                                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-sm text-purple-800">
                                    <div className="flex gap-2 items-center font-bold mb-2">
                                        <Bot className="w-5 h-5" />
                                        Extrator Multimodal
                                    </div>
                                    <p>Cole um texto técnico ou <strong>cole uma imagem (Ctrl+V)</strong>. A IA tentará ler as coordenadas da tabela ou mapa.</p>
                                </div>

                                <div className="relative group">
                                    <textarea
                                        value={aiInput}
                                        onChange={(e) => setAiInput(e.target.value)}
                                        className="w-full p-4 h-40 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-purple-500 focus:bg-white focus:ring-4 focus:ring-purple-500/10 outline-none resize-none font-mono text-sm transition-all"
                                        placeholder="Descreva a localização ou cole uma imagem aqui..."
                                    />

                                    {aiImage && (
                                        <div className="absolute bottom-4 right-4 w-20 h-20 bg-white rounded-lg shadow-md border border-slate-200 p-1 z-10">
                                            <img src={aiImage} className="w-full h-full object-cover rounded" alt="Preview" />
                                            <button onClick={clearImage} className="absolute -top-2 -right-2 bg-red-500 text-white p-0.5 rounded-full shadow-md hover:bg-red-600"><X className="w-3 h-3" /></button>
                                        </div>
                                    )}

                                    <div className="absolute bottom-4 left-4">
                                        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
                                        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-purple-600 transition-colors shadow-sm">
                                            <ImageIcon className="w-3 h-3" /> Carregar Imagem
                                        </button>
                                    </div>
                                </div>

                                <button
                                    onClick={handleAiExtraction}
                                    disabled={aiLoading}
                                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-lg"
                                >
                                    {aiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                    {aiLoading ? "Analisando..." : "Extrair Coordenadas ✨"}
                                </button>
                            </div>
                        )}

                        {/* INPUT MODE: TEXTO (Indigo Theme) */}
                        {mode === 'text' && (
                            <div className="animate-in fade-in duration-300 space-y-4">
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 flex gap-2">
                                    <Info className="w-4 h-4 flex-shrink-0 text-indigo-500" />
                                    <p>Modo ideal para copiar de tabelas. Aceita formatos como <strong>-56°03'41,074"</strong>.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Latitude</label>
                                    <input type="text" value={textLat} onChange={(e) => setTextLat(e.target.value)} className="w-full p-4 font-mono text-lg bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" placeholder="-09°53'01,685&quot;" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Longitude</label>
                                    <input type="text" value={textLng} onChange={(e) => setTextLng(e.target.value)} className="w-full p-4 font-mono text-lg bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" placeholder="-56°03'41,074&quot;" />
                                </div>
                                <button onClick={() => handleConvert()} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-lg">
                                    <ArrowRightLeft className="w-5 h-5" /> Converter
                                </button>
                            </div>
                        )}

                        {/* INPUT MODE: DECIMAL */}
                        {mode === 'decimal' && (
                            <div className="animate-in fade-in duration-300 grid grid-cols-1 gap-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-600 mb-1">Latitude</label>
                                        <input type="number" placeholder="-23.550520" value={lat} onChange={(e) => setLat(e.target.value)} className="w-full p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-600 mb-1">Longitude</label>
                                        <input type="number" placeholder="-46.633308" value={lng} onChange={(e) => setLng(e.target.value)} className="w-full p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                    </div>
                                </div>
                                <button onClick={() => handleConvert()} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-lg">
                                    <ArrowRightLeft className="w-5 h-5" /> Converter
                                </button>
                            </div>
                        )}

                        {/* INPUT MODE: DMS */}
                        {mode === 'dms' && (
                            <div className="animate-in fade-in duration-300 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-600 mb-2">Latitude</label>
                                    <div className="flex gap-2">
                                        <input type="number" placeholder="Graus" value={dmsLat.deg} onChange={(e) => setDmsLat({ ...dmsLat, deg: e.target.value })} className="flex-1 min-w-[70px] p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                        <input type="number" placeholder="Min" value={dmsLat.min} onChange={(e) => setDmsLat({ ...dmsLat, min: e.target.value })} className="flex-1 min-w-[70px] p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                        <input type="number" placeholder="Seg" value={dmsLat.sec} onChange={(e) => setDmsLat({ ...dmsLat, sec: e.target.value })} className="flex-1 min-w-[90px] p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                        <select value={dmsLat.dir} onChange={(e) => setDmsLat({ ...dmsLat, dir: e.target.value })} className="bg-slate-100 border-2 border-slate-200 rounded-xl px-3 font-bold text-slate-700 cursor-pointer">
                                            <option value="S">S</option><option value="N">N</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-600 mb-2">Longitude</label>
                                    <div className="flex gap-2">
                                        <input type="number" placeholder="Graus" value={dmsLng.deg} onChange={(e) => setDmsLng({ ...dmsLng, deg: e.target.value })} className="flex-1 min-w-[70px] p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                        <input type="number" placeholder="Min" value={dmsLng.min} onChange={(e) => setDmsLng({ ...dmsLng, min: e.target.value })} className="flex-1 min-w-[70px] p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                        <input type="number" placeholder="Seg" value={dmsLng.sec} onChange={(e) => setDmsLng({ ...dmsLng, sec: e.target.value })} className="flex-1 min-w-[90px] p-3 bg-white border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
                                        <select value={dmsLng.dir} onChange={(e) => setDmsLng({ ...dmsLng, dir: e.target.value })} className="bg-slate-100 border-2 border-slate-200 rounded-xl px-3 font-bold text-slate-700 cursor-pointer">
                                            <option value="W">W</option><option value="E">E</option>
                                        </select>
                                    </div>
                                </div>
                                <button onClick={() => handleConvert()} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-lg">
                                    <ArrowRightLeft className="w-5 h-5" /> Converter
                                </button>
                            </div>
                        )}

                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200 flex items-center gap-2 animate-in slide-in-from-top-2">
                                <Info className="w-4 h-4" />
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Results Section */}
                    {result && (
                        <div className="mt-8 animate-in slide-in-from-bottom-4 duration-500 border-t pt-6 border-slate-100">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <Maximize2 className="w-5 h-5 text-indigo-500" />
                                    Resultados UTM
                                </h3>
                                <span className="text-xs bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full font-bold border border-indigo-200">
                                    Zona {result.zone} {result.hemisphere}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Easting */}
                                <div className="bg-white p-4 rounded-xl border-2 border-slate-100 shadow-sm relative group hover:border-indigo-400 transition-colors">
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Easting (X)</label>
                                            <div className="text-3xl font-mono text-slate-800 font-bold mt-1 tracking-tight">
                                                {result.easting.toFixed(4)}
                                                <span className="text-lg text-slate-400 font-normal ml-1">m</span>
                                            </div>
                                        </div>
                                        <button onClick={() => copyToClipboard(result.easting.toFixed(4))} className="bg-slate-100 p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all" title="Copiar Valor">
                                            <Copy className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Northing */}
                                <div className="bg-white p-4 rounded-xl border-2 border-slate-100 shadow-sm relative group hover:border-indigo-400 transition-colors">
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Northing (Y)</label>
                                            <div className="text-3xl font-mono text-slate-800 font-bold mt-1 tracking-tight">
                                                {result.northing.toFixed(4)}
                                                <span className="text-lg text-slate-400 font-normal ml-1">m</span>
                                            </div>
                                        </div>
                                        <button onClick={() => copyToClipboard(result.northing.toFixed(4))} className="bg-slate-100 p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all" title="Copiar Valor">
                                            <Copy className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* AI Location Context Button */}
                            <div className="mt-4">
                                {!aiAnalysis && !aiAnalysisLoading && (
                                    <button
                                        onClick={handleAiAnalysis}
                                        className="text-sm font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-2 px-4 py-2 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors border border-purple-200 w-full justify-center md:w-auto"
                                    >
                                        <Sparkles className="w-4 h-4" />
                                        Gerar relatório de localização com IA
                                    </button>
                                )}

                                {aiAnalysisLoading && (
                                    <div className="flex items-center gap-2 text-sm text-purple-600 animate-pulse bg-purple-50 p-3 rounded-lg border border-purple-100">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        A gerar análise geográfica com Gemini...
                                    </div>
                                )}

                                {aiAnalysis && (
                                    <div className="bg-gradient-to-br from-purple-50 to-white p-4 rounded-lg border border-purple-200 mt-2 text-sm text-slate-700 relative animate-in fade-in zoom-in-95">
                                        <div className="absolute top-2 right-2 text-purple-200">
                                            <Bot className="w-8 h-8 opacity-20" />
                                        </div>
                                        <h4 className="font-bold text-purple-800 mb-2 flex items-center gap-2">
                                            <Sparkles className="w-4 h-4" /> Análise de Localização
                                        </h4>
                                        <p className="leading-relaxed whitespace-pre-wrap">{aiAnalysis}</p>
                                    </div>
                                )}
                            </div>

                            {/* Data Verification */}
                            <div className="mt-6 bg-slate-50 rounded-lg p-4 border border-slate-200">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Verificação de Entrada
                                </h4>
                                <div className="grid grid-cols-2 gap-4 text-sm font-mono text-slate-600">
                                    <div>
                                        <span className="text-slate-400">Lat (Dec):</span> {result.inputDec.lat.toFixed(8)}
                                    </div>
                                    <div>
                                        <span className="text-slate-400">Lng (Dec):</span> {result.inputDec.lng.toFixed(8)}
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default SirgasConverter;