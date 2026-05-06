import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    LayoutDashboard, MessageSquare, Calendar, 
    BarChart, Bell, CheckCircle, 
    Search, Smartphone, Zap, Send, ShieldCheck, Lock,
    UserPlus, Database, Activity, 
    UserCheck, Settings, ClipboardList, TrendingUp, Plus,
    AlertTriangle, Sparkles, Bot
} from 'lucide-react';

// --- 核心組件：權限控制 ---
const PermissionGate = ({ type, role, children }) => {
    const isAllowed = type === 'operate' ? role === 'admin' : true;
    return isAllowed ? children : (
        <div className="relative group opacity-50 cursor-not-allowed">
            <div className="pointer-events-none">{children}</div>
        </div>
    );
};

export default function App() {
    const [view, setView] = useState('chat'); // 預設進入聊天接管
    const [user] = useState({ name: '系統管理員', role: 'admin', dept: '決策層' });
    const [chatTarget, setChatTarget] = useState(null);
    const [inputText, setInputText] = useState('');
    const chatEndRef = useRef(null);

    // --- 業務數據 (模擬接管後的 AI 分析資訊流) ---
    const [nfcCheckins, setNfcCheckins] = useState([
        { id: 1, name: '林大華', point: '總部大廳', time: '14:20' },
        { id: 2, name: '陳小美', point: 'VIP 接待區', time: '14:18' }
    ]);

    const [messages, setMessages] = useState([
        { 
            id: 1, userId: 'U8819', sender: 'user', 
            text: '請問這個月的獎金計算方式有調整嗎？', time: '14:05',
            aiCategory: '獎金制度',
            aiSuggestions: ['本月制度無更動，可參考官網附件。', '您好，詳細撥款時間預計在15號。']
        },
        { id: 2, userId: 'U8819', sender: 'admin', text: '您好，本月維持原獎金制度，若有變動會於官網公告。', time: '14:06' },
        { 
            id: 3, userId: 'U1202', sender: 'user', 
            text: 'NFC 報到感應沒反應，請問該怎麼處理？', time: '14:10',
            aiCategory: '硬體排除',
            aiSuggestions: ['請確認手機 NFC 功能已開啟。', '可以嘗試將手機靠近標籤中心點感應。', '若持續失敗，請手動輸入站點代碼。']
        }
    ]);

    const chatList = [
        { id: 'U8819', name: '林大華', lastMsg: '您好，本月維持原獎...', time: '14:06', unread: 0, status: 'online' },
        { id: 'U1202', name: '陳小美', lastMsg: 'NFC 報到感應沒反應...', time: '14:10', unread: 1, status: 'away' },
        { id: 'U5543', name: '張大名', lastMsg: '感謝回覆', time: '昨日', unread: 0, status: 'offline' }
    ];

    const activeMessage = useMemo(() => {
        if (!chatTarget) return null;
        const userMsgs = messages.filter(m => m.userId === chatTarget.id && m.sender === 'user');
        return userMsgs[userMsgs.length - 1]; // 獲取用戶最後一則訊息進行建議回覆
    }, [messages, chatTarget]);

    const [aiLogs] = useState([
        { id: 1, type: 'critical', category: '重大問題', msg: '多位經銷商反應獎金結算數字異常，有群體客訴風險。', user: 'U8819', target: '核心決策組', time: '5m' },
        { id: 2, type: 'complaint', category: '物流延遲', msg: '發貨中心收到包裹破損反映，需查核物流狀況。', user: 'U1202', target: '客服應變組', time: '1h' },
        { id: 3, type: 'faq', category: '一般諮詢', msg: '詢問新產品「晶透精華」的具體提撥積分。', user: 'U5543', target: '一般記錄組', time: '3h' }
    ]);

    const [calendarEvents] = useState([
        { id: 1, date: '2026-05-15', title: '全台領袖高峰年會', dept: '企劃部', status: '進行中' },
        { id: 2, date: '2026-05-18', title: '營運月度審核會', dept: '秘書處', status: '待執行' }
    ]);

    const [staffMatrix] = useState([
        { id: 'S01', name: '張經理', dept: '行政部', canOperate: true, tgTarget: '核心警報組' },
        { id: 'S02', name: '林組長', dept: '客服部', canOperate: false, tgTarget: '客服應變組' },
        { id: 'S03', name: '陳專員', dept: '業務部', canOperate: false, tgTarget: '一般記錄組' }
    ]);

    // NFC 實時報到模擬 (偵測 URL 中的 action=checkin)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('action') === 'checkin') {
            const point = params.get('pointId') || '自動感應站';
            const newLog = { 
                id: Date.now(), 
                name: '現場感應人員', 
                point: point, 
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
            };
            setNfcCheckins(prev => [newLog, ...prev]);
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);

    // 捲動對話到最新
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, chatTarget]);

    const handleSend = () => {
        if (!inputText || !chatTarget) return;
        const newMsg = {
            id: Date.now(),
            userId: chatTarget.id,
            sender: 'admin',
            text: inputText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, newMsg]);
        setInputText('');
    };

    // --- 子視圖：營運看板 ---
    const renderOverview = () => (
        <div className="space-y-6 animate-in fade-in duration-500 font-sans">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="營運總額" value="12.4M" change="+12%" icon={BarChart} color="blue" />
                <StatCard title="AI 異常" value={aiLogs.length} change="待處理" icon={AlertTriangle} color="red" />
                <StatCard title="簽到人次" value={nfcCheckins.length} change="實時同步" icon={Smartphone} color="green" />
                <StatCard title="部門行程" value={calendarEvents.length} change="本週計" icon={ClipboardList} color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
                <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-sm p-6 overflow-hidden flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                            <Zap size={18} className="text-orange-500 fill-orange-500" />
                            AI 靜默監測報表 (來自 LINE OA)
                        </h3>
                        <span className="text-[10px] font-bold text-green-500 bg-green-50 px-2 py-0.5 rounded-full">LIVE</span>
                    </div>
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                        {aiLogs.map((log, i) => (
                            <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-blue-200 transition-colors">
                                <div className="flex justify-between text-[10px] font-bold mb-1">
                                    <span className={log.type === 'critical' ? 'text-red-500' : 'text-orange-500'}>{log.category}</span>
                                    <span className="text-slate-400">推播：{log.target}</span>
                                </div>
                                <p className="text-sm leading-relaxed mb-2 text-slate-700">{log.msg}</p>
                                <div className="flex justify-between text-[9px] font-black uppercase text-slate-400">
                                    <span>UID: {log.user}</span>
                                    <span>{log.time}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 font-sans flex flex-col">
                    <h3 className="font-bold text-sm uppercase mb-6 flex items-center gap-2">
                        <Smartphone size={18} className="text-blue-500" />
                        NFC 實時報到
                    </h3>
                    <div className="space-y-4 flex-1 overflow-y-auto pr-2">
                        {nfcCheckins.map((log, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-colors">
                                <div className="font-sans">
                                    <p className="text-xs font-bold text-slate-800">{log.name}</p>
                                    <p className="text-[9px] text-slate-400 uppercase tracking-tighter mt-1">{log.point}</p>
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">{log.time}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    // --- 子視圖：LINE 接管聊天室 ---
    const renderChatTakeover = () => (
        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm flex h-[78vh] overflow-hidden animate-in fade-in zoom-in-95 duration-300">
            {/* 左側清單 */}
            <div className="w-80 border-r border-slate-50 flex flex-col bg-white shrink-0">
                <div className="p-5 border-b border-slate-50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                        <input type="text" placeholder="搜尋 LINE 用戶..." className="w-full bg-slate-50 border-none rounded-xl py-2.5 pl-9 pr-4 text-xs focus:ring-2 focus:ring-blue-100 outline-none font-medium text-slate-700" />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {chatList.map(chat => (
                        <div 
                            key={chat.id} 
                            onClick={() => setChatTarget(chat)}
                            className={`p-4 flex gap-3 cursor-pointer transition-all border-b border-slate-50/50 ${chatTarget?.id === chat.id ? 'bg-blue-50/50 border-l-4 border-l-blue-600' : 'hover:bg-slate-50'}`}
                        >
                            <div className="relative">
                                <div className="w-11 h-11 bg-slate-100 rounded-2xl flex-shrink-0 flex items-center justify-center font-bold text-slate-500 uppercase">{chat.name[0]}</div>
                                {chat.status === 'online' && <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>}
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <div className="flex justify-between items-baseline mb-0.5">
                                    <span className="text-xs font-bold truncate text-slate-800">{chat.name}</span>
                                    <span className="text-[9px] text-slate-400 font-mono">{chat.time}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 truncate tracking-tight">{chat.lastMsg}</p>
                            </div>
                            {chat.unread > 0 && <div className="min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full mt-2 shadow-sm">{chat.unread}</div>}
                        </div>
                    ))}
                </div>
            </div>

            {/* 右側對話窗 */}
            <div className="flex-1 flex flex-col bg-[#F4F7F9]">
                {chatTarget ? (
                    <>
                        <div className="p-4 bg-white border-b border-slate-50 flex justify-between items-center z-10 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 text-[10px] font-bold uppercase tracking-widest">{chatTarget.name[0]}</div>
                                <div>
                                    <span className="text-sm font-bold text-slate-800">{chatTarget.name}</span>
                                    <p className="text-[9px] text-green-500 font-black uppercase tracking-widest">已接管此對話傳送</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-slate-400">
                                <button className="p-2 hover:bg-slate-50 rounded-xl transition-colors"><Activity size={18} /></button>
                                <button className="p-2 hover:bg-slate-50 rounded-xl transition-colors"><Settings size={18} /></button>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-5">
                            {messages.filter(m => m.userId === chatTarget.id).map(msg => (
                                <div key={msg.id} className={`flex flex-col ${msg.sender === 'admin' ? 'items-end' : 'items-start'}`}>
                                    {msg.sender === 'user' && msg.aiCategory && (
                                        <span className="text-[9px] font-black text-blue-500 mb-1 flex items-center gap-1 uppercase tracking-widest">
                                            <Bot size={10} /> AI 分類：{msg.aiCategory}
                                        </span>
                                    )}
                                    <div className="max-w-[75%]">
                                        <div className={`p-3.5 text-[13px] shadow-sm leading-relaxed ${
                                            msg.sender === 'admin' 
                                            ? 'bg-[#06c755] text-white rounded-tl-2xl rounded-tr-sm rounded-br-2xl rounded-bl-2xl' 
                                            : 'bg-white font-medium text-slate-700 border border-slate-200 rounded-tl-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl'
                                        }`}>
                                            {msg.text}
                                        </div>
                                        <p className={`text-[9px] mt-1 text-slate-400 font-mono font-bold ${msg.sender === 'admin' ? 'text-right' : 'text-left'}`}>{msg.time}</p>
                                    </div>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>

                        {/* AI 建議回覆區塊 */}
                        <div className="p-4 bg-white/60 backdrop-blur-sm border-t border-slate-100">
                            {activeMessage?.aiSuggestions && (
                                <div className="mb-4">
                                    <div className="flex items-center gap-1.5 mb-2 px-1">
                                        <Sparkles size={12} className="text-orange-400 fill-orange-400" />
                                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">AI 建議回覆：內容已根據知識庫優化</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {activeMessage.aiSuggestions.map((s, idx) => (
                                            <button 
                                                key={idx} 
                                                onClick={() => setInputText(s)}
                                                className="bg-white border border-[#06c755] text-[#06c755] hover:bg-[#06c755] hover:text-white transition-all px-3 py-1.5 rounded-full text-[11px] font-bold shadow-sm"
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                                <button className="p-2.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"><Plus size={20}/></button>
                                <input 
                                    type="text" 
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="在此輸入訊息..." 
                                    className="flex-1 bg-transparent border-none px-2 py-2 text-xs focus:ring-0 outline-none font-medium text-slate-700"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                />
                                <button 
                                    onClick={handleSend}
                                    className="bg-[#06c755] text-white p-2.5 rounded-xl hover:bg-[#05a64a] shadow-md shadow-green-100 transition-all"
                                >
                                    <Send size={18}/>
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-300 animate-in">
                        <div className="w-20 h-20 bg-white rounded-[32px] flex items-center justify-center shadow-sm mb-6">
                            <MessageSquare size={40} strokeWidth={1.5} className="text-slate-200" />
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.3em]">選擇一個 LINE OA 對話</p>
                        <p className="text-[10px] mt-2 text-slate-400 tracking-widest uppercase">Messaging API: Connection Stable</p>
                    </div>
                )}
            </div>
        </div>
    );

    // --- 子頁面：CRM 權限管理 ---
    const renderCRMView = () => (
        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden animate-in fade-in duration-500 font-sans">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-slate-800">
                    <ShieldCheck size={20} className="text-blue-600" />
                    權限矩陣與 TG 指派
                </h2>
                <button className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-800 transition-all">註冊新成員</button>
            </div>
            <table className="w-full text-left text-[11px] font-sans">
                <thead className="bg-slate-50/50 text-slate-400 uppercase font-black">
                    <tr>
                        <th className="p-4 pl-6">姓名/部門</th>
                        <th className="p-4 text-center">操作權</th>
                        <th className="p-4">TG 分組</th>
                        <th className="p-4 pr-6 text-right">設定</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                    {staffMatrix.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 pl-6">
                                <p className="font-bold text-slate-800 text-sm">{s.name}</p>
                                <p className="text-[10px] text-slate-400 uppercase tracking-tighter mt-0.5">{s.dept}</p>
                            </td>
                            <td className="p-4 text-center">
                                {s.canOperate ? <CheckCircle size={16} className="text-blue-500 mx-auto" /> : <div className="w-4 h-4 border border-slate-200 rounded-full mx-auto"></div>}
                            </td>
                            <td className="p-4">
                                <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100 font-bold uppercase tracking-widest text-[9px]">{s.tgTarget}</span>
                            </td>
                            <td className="p-4 pr-6 text-right">
                                <button className="text-slate-300 hover:text-blue-500 transition-colors"><Settings size={16}/></button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    // --- 主導航架構 ---
    return (
        <div className="min-h-screen flex bg-slate-50 text-slate-800 font-sans antialiased">
            {/* 注入隱藏滾動條的自訂樣式 */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            `}</style>

            {/* Sidebar */}
            <aside className="w-[260px] bg-white border-r border-slate-100 flex flex-col p-6 hidden lg:flex fixed h-full z-40 shadow-sm font-sans">
                <div className="flex items-center gap-3 mb-10 px-2">
                    <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                        <LayoutDashboard size={20} />
                    </div>
                    <div className="leading-none">
                        <h1 className="text-base font-black uppercase tracking-tight text-slate-800">DS PRO</h1>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1 italic">Intelligent Hub</p>
                    </div>
                </div>
                
                <nav className="flex-1 space-y-2">
                    <NavItem id="overview" icon={LayoutDashboard} label="營運數據看板" active={view === 'overview'} onClick={setView} />
                    <NavItem id="chat" icon={MessageSquare} label="LINE 接管對話" active={view === 'chat'} onClick={setView} />
                    <NavItem id="crm" icon={ShieldCheck} label="CRM 與權限矩陣" active={view === 'crm'} onClick={setView} />
                    <div className="pt-8 opacity-40">
                        <p className="px-4 text-[9px] font-black uppercase tracking-widest mb-3">資料庫連結</p>
                        <NavItem id="cal" icon={Calendar} label="部門行事曆" active={view === 'cal'} onClick={setView} />
                    </div>
                </nav>

                <div className="mt-auto p-5 bg-slate-50 rounded-3xl text-center border border-slate-100">
                    <div className="flex items-center justify-center gap-2 text-green-500 text-[10px] font-black uppercase mb-1">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                        Worker & GAS: OK
                    </div>
                    <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">AI Silent Monitoring</p>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 lg:ml-[260px] p-8 overflow-y-auto h-screen custom-scrollbar">
                <header className="max-w-5xl mx-auto flex justify-between items-center mb-8">
                    <div className="relative w-80 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16}/>
                        <input type="text" placeholder="搜尋功能、簽到、人員..." className="w-full bg-white border border-slate-100 rounded-2xl py-3 pl-11 pr-4 text-xs shadow-sm focus:ring-2 focus:ring-blue-100 outline-none font-medium text-slate-700 transition-all" />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 relative cursor-pointer hover:bg-slate-50 transition-all shadow-sm group">
                            <Bell size={18} className="group-hover:rotate-12 transition-transform" />
                            <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-white"></div>
                        </div>
                        <div className="h-8 w-px bg-slate-200 mx-1"></div>
                        <div className="flex items-center gap-3 bg-white p-1.5 pr-4 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:bg-slate-50 transition-all">
                            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xs uppercase">{user.name[0]}</div>
                            <div className="text-left leading-none">
                                <p className="text-[11px] font-black text-slate-800 uppercase">{user.name}</p>
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">{user.dept}</p>
                            </div>
                        </div>
                    </div>
                </header>

                <div className="max-w-5xl mx-auto">
                    {view === 'overview' && renderOverview()}
                    {view === 'chat' && renderChatTakeover()}
                    {view === 'crm' && renderCRMView()}
                    {view === 'cal' && (
                        <div className="p-20 text-center bg-white rounded-[40px] border border-dashed border-slate-200 animate-in fade-in zoom-in-95 duration-500">
                            <Activity size={48} className="mx-auto text-slate-200 mb-4" />
                            <p className="text-slate-500 font-bold uppercase tracking-[0.3em] text-xs">跨部資料同步中</p>
                            <p className="text-slate-400 text-[10px] mt-2 uppercase tracking-widest italic">Connecting to Google Sheets...</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

// --- 共用小組件 ---
function NavItem({ id, icon: Icon, label, active, onClick }) {
    return (
        <button 
            onClick={() => onClick(id)}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-200 font-sans ${active ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20 scale-105' : 'text-slate-500 hover:bg-slate-50'}`}
        >
            <Icon size={18} strokeWidth={active ? 2.5 : 2} />
            <span className="text-xs font-bold tracking-tight">{label}</span>
        </button>
    );
}

function StatCard({ title, value, change, icon: Icon, color }) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600',
        red: 'bg-red-50 text-red-600',
        green: 'bg-green-50 text-green-600',
        purple: 'bg-purple-50 text-purple-600',
    };
    const textClasses = {
        blue: 'text-green-500',
        green: 'text-green-500',
        red: 'text-red-500',
        purple: 'text-slate-400',
    };

    return (
        <div className="bg-white p-7 rounded-[32px] border border-slate-100 shadow-sm group hover:shadow-lg transition-all font-sans relative overflow-hidden">
            <div className="flex justify-between items-start font-sans relative z-10">
                <div>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest leading-none mb-3 font-sans">{title}</p>
                    <h3 className="text-2xl font-black text-slate-800 tracking-tighter group-hover:text-blue-600 transition-colors font-sans mb-1">{value}</h3>
                    <span className={`text-[10px] font-black ${textClasses[color] || 'text-slate-400'} font-sans`}>{change}</span>
                </div>
                <div className={`p-4 ${colorClasses[color]} rounded-[20px] font-sans transition-transform group-hover:scale-110`}>
                    <Icon size={24} />
                </div>
            </div>
        </div>
    );
}
