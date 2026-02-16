import React, { useState, useEffect } from 'react';
import { Clock, Video, X, Bell, RefreshCw, ChevronRight } from 'lucide-react';
// This import connects React to your Rust Backend
import { invoke } from '@tauri-apps/api/core';

export default function App() {
  const [meetings, setMeetings] = useState([]);
  const [upNextMeeting, setUpNextMeeting] = useState({});
  const [laterMeetings, setUpLaterMeetings] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [permissionError, setPermissionError] = useState(false);

  const ALERT_THRESHOLD = 5000;

  // --- Helper: Extract Link ---
  const extractVideoLink = (event) => {
    const text = (event.description || "") + " " + (event.location || "") + " " + (event.url || "");
    const match = text.match(/(https?:\/\/(?:us0[2-9]\.web\.|www\.|meet\.)?(?:zoom\.us|google\.com|teams\.microsoft\.com|webex\.com)\/[^\s]+)/);
    return match ? match[0] : null;
  };

  const determinePlatform = (link) => {
    if (!link) return "In Person / Other";
    if (link.includes("zoom.us")) return "Zoom";
    if (link.includes("google.com")) return "Google Meet";
    if (link.includes("teams.microsoft")) return "Microsoft Teams";
    if (link.includes("webex")) return "Webex";
    return "Video Call";
  };

  const getPlatformColor = (platform) => {
    switch (platform) {
      case "Zoom": return "bg-blue-600";
      case "Google Meet": return "bg-green-600";
      case "Microsoft Teams": return "bg-purple-600";
      default: return "bg-neutral-600";
    }
  };

  // --- Data Fetching ---
  const fetchMeetings = async () => {
    setLoading(true);
    try {
      const result = await invoke('get_calendar_events');
      const eod = new Date();
      eod.setHours(23, 59, 59, 999);
      
      const rawEvents = JSON.parse(result);
      
      const processed = rawEvents
        .map(ev => {
          const link = extractVideoLink(ev);
          return {
            id: ev.title + ev.start,
            title: ev.title,
            start: new Date(ev.start),
            end: new Date(ev.end),
            link: link,
            platform: determinePlatform(link),
            color: getPlatformColor(determinePlatform(link)),
            isAllDay: ev.isAllDay
          };
        })
        .sort((a, b) => a.start - b.start)
        .filter(ev => new Date(ev.start) > new Date() && new Date(ev.start) < eod && !ev.isAllDay); 

      setMeetings(processed);

      const nextMeeting = processed.find(ev => new Date(ev.start) > new Date());
      setUpNextMeeting(nextMeeting);
      setUpLaterMeetings(processed.filter(ev => new Date(ev.start) > new Date() && ev.id !== nextMeeting.id));
      
      setPermissionError(false);
    } catch (error) {
      console.error("Failed to fetch meetings:", error);
      setPermissionError(true);
    } finally {
      setLoading(false);
    }
  };

  // Initial Fetch & Auto-Refresh
  useEffect(() => {
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // --- Timer & Alert Trigger ---
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      checkMeetings(now);
    }, 1000);
    return () => clearInterval(timer);
  }, [meetings, activeAlert]);

  // --- Window Mode Switching ---
  useEffect(() => {
    if (activeAlert) {
      invoke('enter_alert_mode').catch(console.error);
    } else {
      invoke('exit_alert_mode').catch(console.error);
    }
  }, [activeAlert]);

  useEffect(() => {
    setUpLaterMeetings(meetings.filter(ev => new Date(ev.start) > new Date() && ev.id !== upNextMeeting.id));
  }, [upNextMeeting]);

  const checkMeetings = (now) => {
    if (activeAlert) return;
    
    meetings.forEach(meeting => {
      const timeDiff = meeting.start - now;
      if (timeDiff > 0 && timeDiff < ALERT_THRESHOLD) {
        triggerAlert(meeting);
      }
    });
  };

  const triggerAlert = (meeting) => {
    setActiveAlert(meeting);
    setTimeout(fetchMeetings, ALERT_THRESHOLD);
  };
  const dismissAlert = () => {
    setActiveAlert(null);
    fetchMeetings();
  };
  
  const joinMeeting = (link) => {
    if (link) {
      invoke('open_link', { url: link }).catch(() => window.open(link, '_blank'));
    }
    dismissAlert();
  };

  // --- Formatting Helpers ---
  const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const getTimeUntil = (date) => {
    const diff = date - currentTime;
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      return `in ${hours}h ${mins % 60}m`;
    }
    return `in ${mins}m ${secs}s`;
  };

  // --- Full Screen Alert Component (Elegant Black) ---
  const FullScreenAlert = ({ meeting }) => (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-neutral-950">
      <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-transparent pointer-events-none"></div>
      
      <button 
        onClick={dismissAlert}
        className="absolute top-8 right-8 p-3 hover:bg-neutral-800 rounded-full text-neutral-400 hover:text-white transition-colors cursor-pointer z-10"
      >
        <X size={32} />
      </button>

      <div className="text-center space-y-8 max-w-5xl px-6 relative z-10">
        <Clock size={80} className="text-red-500 mx-auto mb-4 animate-bounce opacity-90" />
        
        <h2 className="text-sm md:text-base font-medium text-red-500 uppercase tracking-[0.3em]">Happening Now</h2>
        
        <h1 className="text-3xl md:text-6xl font-black text-white leading-tight tracking-tight">
          {meeting.title}
        </h1>
        
        <div className="flex items-center justify-center gap-4 text-2xl md:text-3xl text-neutral-400 font-light">
          <Video size={32} />
          <span>{meeting.platform}</span>
          <span className="text-neutral-700">•</span>
          <span>{formatTime(meeting.start)}</span>
        </div>

        <div className="pt-12">
          {meeting.link ? (
            <button 
              onClick={() => joinMeeting(meeting.link)}
              className="px-12 py-6 bg-white text-black text-2xl md:text-3xl font-bold rounded-full hover:scale-105 transition-transform flex items-center gap-4 mx-auto cursor-pointer shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
            >
              <Video className="w-8 h-8" /> JOIN CALL
            </button>
          ) : (
            <div className="text-neutral-500 text-xl font-medium">No video link found</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-red-900 selection:text-white">
      {activeAlert && <FullScreenAlert meeting={activeAlert} />}

      <div className="max-w-md mx-auto p-6">
        {/* Header */}
        <header className="mb-10 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded-xl flex items-center justify-center shadow-md">
                <Bell className="text-white w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">In Your Face Reminder</h1>
            </div>
            <button 
              onClick={fetchMeetings} 
              disabled={loading}
              className={`p-2 hover:bg-neutral-900 rounded-lg transition-colors cursor-pointer text-neutral-500 hover:text-white ${loading ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          {/* Subtitle */}
          <p className="text-neutral-500 text-xs font-medium tracking-wide ml-1">
            Remind meetings directly in your face
          </p>
        </header>

        {permissionError && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-red-200 text-sm">
            <strong>Permission Required:</strong> Please allow the app to access your Calendar.
          </div>
        )}

        <div className="space-y-6">
          {meetings.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-neutral-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="text-neutral-700" size={24} />
              </div>
              <p className="text-neutral-400 font-medium">No upcoming meetings</p>
              <p className="text-xs mt-2 text-neutral-600">
                You are free for the rest of the day
              </p>
            </div>
          ) : (
            <>
              {/* Next Meeting */}
              {upNextMeeting && Object.keys(upNextMeeting).length > 0 && (
                <div className="group relative bg-neutral-900 rounded-2xl p-6 border border-neutral-800 transition-all hover:border-neutral-700">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${upNextMeeting.color}`}></div>
                  
                  <div className="flex justify-between items-end mb-3">
                    <span className="text-neutral-500 text-[10px] font-bold tracking-widest uppercase">Up Next</span>
                    <span className="text-red-500 font-mono font-bold text-sm animate-pulse">
                      {getTimeUntil(upNextMeeting.start)}
                    </span>
                  </div>
                  
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold text-white mb-2 leading-tight tracking-tight">{upNextMeeting.title}</h3>
                    <div className="flex items-center gap-2 text-neutral-400 text-sm font-medium">
                      <span className="bg-neutral-800 px-2 py-0.5 rounded text-xs text-neutral-300">{formatTime(upNextMeeting.start)}</span>
                      <span>•</span>
                      <span>{upNextMeeting.platform}</span>
                    </div>
                  </div>

                  <button 
                    onClick={() => triggerAlert(upNextMeeting)} 
                    className="w-full py-3 bg-white hover:bg-neutral-200 text-black rounded-xl font-bold text-sm transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    Check Alert now! <ChevronRight size={14} />
                  </button>
                </div>
              )}
              
              {/* List */}
              {Object.keys(laterMeetings).length > 0 ? (
                <div>
                  <h3 className="text-neutral-500 font-bold text-[10px] mb-4 px-1 tracking-widest uppercase">Later Today</h3>
                  <div className="space-y-2">
                    {laterMeetings.map((meeting) => (
                      <div key={meeting.id} className="flex items-center gap-4 p-4 bg-neutral-900/50 hover:bg-neutral-900 rounded-xl border border-transparent hover:border-neutral-800 transition-all group">
                        <div className={`w-1 h-8 rounded-full opacity-50 group-hover:opacity-100 transition-opacity ${meeting.color}`}></div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-neutral-300 group-hover:text-white truncate transition-colors">{meeting.title}</h4>
                          <p className="text-xs text-neutral-500 mt-0.5">{formatTime(meeting.start)} • {meeting.platform}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-neutral-900 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock className="text-neutral-700" size={24} />
                  </div>
                  <p className="text-neutral-400 font-medium">No later meetings for today</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}