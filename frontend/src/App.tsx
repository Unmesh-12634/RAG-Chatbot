import React, { useState, useEffect, useRef } from 'react';
import { 
  fetchVideoMetadata, 
  indexVideosInDB, 
  streamChatResponse
} from './api';
import type { VideoData, SourceCitation } from './api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[];
}



export default function App() {
  // Theme Management State
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const savedTheme = localStorage.getItem('rag_theme');
    return (savedTheme as 'dark' | 'light') || 'dark';
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rag_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // URLs & Fetching State
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Video Data
  const [videoA, setVideoA] = useState<VideoData | null>(null);
  const [videoB, setVideoB] = useState<VideoData | null>(null);

  // Indexing Vector DB State
  const [provider, setProvider] = useState<string>('local');
  const [apiKey, setApiKey] = useState<string>('');
  const [isIndexing, setIsIndexing] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);
  const [indexMessage, setIndexMessage] = useState<string | null>(null);

  // Chat Interface State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingSources, setStreamingSources] = useState<SourceCitation[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);

  // Modals & Layouts
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Refs for scrolling chat & accumulating streaming buffers safely without stale closures
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const accumulatedTextRef = useRef<string>('');
  const accumulatedSourcesRef = useRef<SourceCitation[]>([]);

  // Load API Keys from localStorage on mount
  useEffect(() => {
    const savedProvider = localStorage.getItem('rag_provider');
    const savedKey = localStorage.getItem('rag_api_key');
    
    if (savedProvider) setProvider(savedProvider);
    if (savedKey) setApiKey(savedKey);

    setIndexMessage("Welcome to RAG Creator Studio! Enter video links above and click 'Analyze' to begin.");
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, streamingContent]);

  // Handle Settings Save
  const handleSaveSettings = (selectedProvider: string, enteredKey: string) => {
    setProvider(selectedProvider);
    setApiKey(enteredKey);
    localStorage.setItem('rag_provider', selectedProvider);
    localStorage.setItem('rag_api_key', enteredKey);
    setIsSettingsOpen(false);
  };

  // Perform Scrape Fetch AND auto-index immediately inside a continuous pipeline
  const handleFetchMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsFetching(true);
    setFetchError(null);
    setIndexMessage(null);
    setIsIndexed(false);
    setChatMessages([]);
    
    try {
      const data = await fetchVideoMetadata(urlA, urlB);
      setVideoA(data.video_a);
      setVideoB(data.video_b);

      // Auto-Index IMMEDIATELY to unlock chat without manual clicks
      setIsIndexing(true);
      setIndexMessage("Video details successfully parsed! Re-indexing vector store databases...");
      const res = await indexVideosInDB(data.video_a, data.video_b, provider, apiKey);
      if (res.success) {
        setIsIndexed(true);
        setIndexMessage("Auto-index complete! Conversational analysis is fully unlocked.");
      }
    } catch (err: any) {
      setFetchError(err.message || 'An error occurred while fetching video metadata.');
    } finally {
      setIsFetching(false);
      setIsIndexing(false);
    }
  };

  // Handle Editing Metadata in UI
  const handleMetaChange = (videoTag: 'A' | 'B', field: keyof VideoData, value: any) => {
    const updateFunc = videoTag === 'A' ? setVideoA : setVideoB;
    const currentVideo = videoTag === 'A' ? videoA : videoB;
    
    if (!currentVideo) return;

    updateFunc((prev: any) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      
      // Auto-recalculate engagement rate if views, likes, or comments change
      if (['views', 'likes', 'comments'].includes(field as string)) {
        const views = Number(updated.views) || 0;
        const likes = Number(updated.likes) || 0;
        const comments = Number(updated.comments) || 0;
        updated.engagement_rate = views > 0 ? Number(((likes + comments) / views * 100).toFixed(2)) : 0;
      }
      return updated;
    });

    // Reset indexed state since underlying data has changed, letting users sync manual changes
    setIsIndexed(false);
  };

  // Index Videos inside Vector DB manually
  const handleIndexVideos = async () => {
    if (!videoA || !videoB) return;
    setIsIndexing(true);
    setIndexMessage(null);
    
    try {
      const res = await indexVideosInDB(videoA, videoB, provider, apiKey);
      if (res.success) {
        setIsIndexed(true);
        setIndexMessage(res.message);
        setChatMessages([]);
      }
    } catch (err: any) {
      setIndexMessage(`Indexing failed: ${err.message}`);
      setIsIndexed(false);
    } finally {
      setIsIndexing(false);
    }
  };

  // Send Message & Stream RAG response
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputQuestion).trim();
    if (!text) return;

    if (!isIndexed) {
      setChatError("Please index the video data in the vector store before starting the analysis.");
      return;
    }

    // Append User message
    const userMsg: ChatMessage = { role: 'user', content: text };
    setChatMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputQuestion('');
    
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingSources([]);
    setChatError(null);

    // ⚡ RESET MUTABLE ACCUMULATORS TO PREVENT STALE CLOSURES
    accumulatedTextRef.current = '';
    accumulatedSourcesRef.current = [];

    try {
      await streamChatResponse(
        text,
        provider,
        apiKey,
        (sources) => {
          accumulatedSourcesRef.current = sources;
          setStreamingSources(sources);
        },
        (token) => {
          accumulatedTextRef.current += token;
          setStreamingContent(accumulatedTextRef.current);
        },
        () => {
          // ⚡ RESOLVED STALE CLOSURE: Read directly from mutable refs
          const finalContent = accumulatedTextRef.current;
          const finalSources = accumulatedSourcesRef.current;

          setChatMessages((prev) => [
            ...prev,
            { 
              role: 'assistant', 
              content: finalContent, 
              sources: finalSources 
            }
          ]);

          // Clear streaming state
          setStreamingContent('');
          setStreamingSources([]);
          accumulatedTextRef.current = '';
          accumulatedSourcesRef.current = [];
          setIsStreaming(false);
        },
        (errorMsg) => {
          setChatError(errorMsg);
          setIsStreaming(false);
        }
      );
    } catch (err: any) {
      setChatError(err.message || 'Stream processing encountered an error.');
      setIsStreaming(false);
    }
  };

  // Submit via Enter Key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // UI presets
  const chatPresets = [
    { label: "Why did A get more engagement?", text: "Why did Video A get more engagement than Video B?" },
    { label: "Compare hooks (first 5s)", text: "Compare the hooks in the first 5 seconds." },
    { label: "Check Video B creator details", text: "Who's the creator of Video B and what's their follower count?" },
    { label: "Suggest improvements for B", text: "Suggest improvements for B based on what worked in A." }
  ];

  return (
    <div className="app-container">
      {/* Dynamic Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal 
          currentProvider={provider}
          currentKey={apiKey}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}

      {/* Modern Premium Header */}
      <header className="header">
        <div className="logo-section">
          <div className="logo-icon">📊</div>
          <h1 className="logo-text">RAG Creator Studio</h1>
        </div>
        <div className="header-actions">
          {videoA && videoB && (
            <div className="sync-status">
              <span className={`status-dot ${isIndexed ? 'active' : ''}`}></span>
              <span style={{ fontSize: '0.8rem', color: isIndexed ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                {isIndexed ? 'Vector Store Sync' : 'Indexing Required'}
              </span>
            </div>
          )}
          <button 
            className="theme-toggle-btn" 
            onClick={toggleTheme} 
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? (
              <svg className="theme-icon sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg className="theme-icon moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
          </button>
          <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
            ⚙️ AI Settings
          </button>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <main className="dashboard-grid">
        
        {/* Left Side: Fetching and Editable Video Workspaces */}
        <section className="left-pane">
          
          {/* Card 1: Video Import Form */}
          <div className="glass-card">
            <div className="card-header">
              <h2 className="card-title">🔗 Compare Social Media Videos</h2>
            </div>
            <div className="card-body">
              <form onSubmit={handleFetchMetadata} className="url-form">
                <div className="inputs-row">
                  <div className="input-group">
                    <label className="input-label" htmlFor="yt-url">Video A (YouTube URL)</label>
                    <div className="input-wrapper">
                      <span className="input-icon">📹</span>
                      <input 
                        id="yt-url"
                        type="url" 
                        className="input-field" 
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={urlA}
                        onChange={(e) => setUrlA(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="input-group">
                    <label className="input-label" htmlFor="ig-url">Video B (Instagram Reel URL)</label>
                    <div className="input-wrapper">
                      <span className="input-icon">📸</span>
                      <input 
                        id="ig-url"
                        type="url" 
                        className="input-field" 
                        placeholder="https://www.instagram.com/reel/..."
                        value={urlB}
                        onChange={(e) => setUrlB(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
                
                <button type="submit" className="submit-btn" disabled={isFetching}>
                  {isFetching ? (
                    <>
                      <span className="loading-spinner"></span>
                      Fetching Transcripts & Metrics...
                    </>
                  ) : (
                    '🚀 Analyze & Extract Video Details'
                  )}
                </button>
              </form>
              
              {fetchError && (
                <div className="alert-panel" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                  <span className="alert-icon" style={{ color: 'var(--accent-yt)' }}>⚠️</span>
                  <div>{fetchError}</div>
                </div>
              )}
            </div>
          </div>

          {/* Side-by-side editable cards */}
          {videoA && videoB ? (
            <>
              <div className="video-workspace">
                {/* VIDEO A: YouTube */}
                <div className="glass-card video-card youtube">
                  <div className="card-header">
                    <span className="badge youtube">YouTube</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {videoA.video_id}</span>
                  </div>
                  <div className="card-body">
                    <div className="metadata-grid">
                      <div className="metadata-item span-2">
                        <label className="meta-label">Video Title</label>
                        <input 
                          type="text" 
                          className="meta-input" 
                          value={videoA.title}
                          onChange={(e) => handleMetaChange('A', 'title', e.target.value)}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Creator Handle</label>
                        <input 
                          type="text" 
                          className="meta-input" 
                          value={videoA.creator}
                          onChange={(e) => handleMetaChange('A', 'creator', e.target.value)}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Subscribers</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoA.follower_count}
                          onChange={(e) => handleMetaChange('A', 'follower_count', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Views</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoA.views}
                          onChange={(e) => handleMetaChange('A', 'views', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Likes</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoA.likes}
                          onChange={(e) => handleMetaChange('A', 'likes', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Comments</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoA.comments}
                          onChange={(e) => handleMetaChange('A', 'comments', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Duration (s)</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoA.duration}
                          onChange={(e) => handleMetaChange('A', 'duration', Number(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="engagement-calc-box">
                      <div>
                        <div className="er-label">Engagement Rate</div>
                        <div className="er-formula">Formula: (Likes + Comments) / Views</div>
                      </div>
                      <div className="er-value">{videoA.engagement_rate}%</div>
                    </div>

                    <div className="transcript-wrapper">
                      <label className="meta-label">Transcript & Timestamps</label>
                      <textarea 
                        className="transcript-textarea" 
                        value={videoA.transcript}
                        onChange={(e) => handleMetaChange('A', 'transcript', e.target.value)}
                        placeholder="Video A Transcript..."
                      />
                    </div>
                  </div>
                </div>

                {/* VIDEO B: Instagram Reel */}
                <div className="glass-card video-card instagram">
                  <div className="card-header">
                    <span className="badge instagram">Instagram Reel</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {videoB.video_id}</span>
                  </div>
                  <div className="card-body">
                    <div className="metadata-grid">
                      <div className="metadata-item span-2">
                        <label className="meta-label">Reel Title / Uploader</label>
                        <input 
                          type="text" 
                          className="meta-input" 
                          value={videoB.title}
                          onChange={(e) => handleMetaChange('B', 'title', e.target.value)}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Creator Handle</label>
                        <input 
                          type="text" 
                          className="meta-input" 
                          value={videoB.creator}
                          onChange={(e) => handleMetaChange('B', 'creator', e.target.value)}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Followers</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoB.follower_count}
                          onChange={(e) => handleMetaChange('B', 'follower_count', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Views</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoB.views}
                          onChange={(e) => handleMetaChange('B', 'views', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Likes</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoB.likes}
                          onChange={(e) => handleMetaChange('B', 'likes', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Comments</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoB.comments}
                          onChange={(e) => handleMetaChange('B', 'comments', Number(e.target.value))}
                        />
                      </div>
                      <div className="metadata-item">
                        <label className="meta-label">Duration (s)</label>
                        <input 
                          type="number" 
                          className="meta-input" 
                          value={videoB.duration}
                          onChange={(e) => handleMetaChange('B', 'duration', Number(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="engagement-calc-box">
                      <div>
                        <div className="er-label">Engagement Rate</div>
                        <div className="er-formula">Formula: (Likes + Comments) / Views</div>
                      </div>
                      <div className="er-value">{videoB.engagement_rate}%</div>
                    </div>

                    <div className="transcript-wrapper">
                      <label className="meta-label">Transcript & Timestamps</label>
                      <textarea 
                        className="transcript-textarea" 
                        value={videoB.transcript}
                        onChange={(e) => handleMetaChange('B', 'transcript', e.target.value)}
                        placeholder="Video B Transcript..."
                      />
                    </div>

                    {videoB.message && (
                      <div className="alert-panel">
                        <span className="alert-icon">ℹ️</span>
                        <div>{videoB.message}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sync Trigger Panel */}
              <div className="glass-card sync-panel">
                <div className="sync-status">
                  <span className={`status-dot ${isIndexed ? 'active' : ''}`}></span>
                  <span style={{ fontSize: '0.88rem' }}>
                    {isIndexed ? (
                      <span style={{ color: 'var(--accent-green)', fontWeight: '600' }}>✓ Transcripts ready in Vector Store DB!</span>
                    ) : (
                      'Changes detected! Re-sync with Vector DB'
                    )}
                  </span>
                </div>
                <button 
                  className="sync-btn" 
                  onClick={handleIndexVideos}
                  disabled={isIndexing}
                  style={{ 
                    background: isIndexed ? 'rgba(22, 163, 74, 0.08)' : 'rgba(99, 102, 241, 0.1)', 
                    borderColor: isIndexed ? 'var(--accent-green)' : 'var(--primary)' 
                  }}
                >
                  {isIndexing ? (
                    <>
                      <span className="loading-spinner"></span>
                      Indexing Transcripts...
                    </>
                  ) : (
                    isIndexed ? '✓ Sync Completed' : '⚡ Sync & Re-Index Videos'
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="glass-card" style={{ padding: '2.5rem 1.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '1.25rem' }}>
              <div style={{ fontSize: '3rem' }}>📊</div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: '1.25rem' }}>No Video Data Loaded</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto', lineHeight: '1.5' }}>
                Enter a YouTube video URL and an Instagram Reel URL in the fields above, then click <strong>Analyze & Extract Video Details</strong> to load metrics, transcripts, and start comparative indexing.
              </p>
            </div>
          )}

          {indexMessage && (
            <div className="alert-panel" style={{ background: isIndexed ? 'rgba(22, 163, 74, 0.08)' : '', borderColor: isIndexed ? 'rgba(22, 163, 74, 0.2)' : '' }}>
              <span className="alert-icon" style={{ color: isIndexed ? 'var(--accent-green)' : 'var(--primary)' }}>
                {isIndexed ? '✓' : 'ℹ️'}
              </span>
              <div>{indexMessage}</div>
            </div>
          )}

        </section>

        {/* Right Side: RAG Comparative Chat Interface */}
        <section className="right-pane">
          <div className="chat-pane">
            
            {/* Chat Title bar */}
            <div className="chat-header">
              <div className="chat-title-info">
                <span className="chat-icon">💬</span>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: '700' }}>Comparative Strategy Assistant</h3>
                  <p className="chat-subtitle">Ask comparative analytics questions regarding Video A and B</p>
                </div>
              </div>
              {chatMessages.length > 0 && (
                <button className="clear-chat-btn" onClick={() => setChatMessages([])} title="Clear Chat History">
                  🗑️
                </button>
              )}
            </div>

            {/* Message bubble feed */}
            <div className="chat-messages">
              {chatMessages.length === 0 && !isStreaming && (
                <div className="initial-welcome">
                  <div className="welcome-icon">⚡</div>
                  <h4 className="welcome-title">Video Comparison RAG Assistant</h4>
                  <p className="welcome-desc">
                    Ready to go! Preset comparative strategies are loaded. Click any preset or type your question below!
                  </p>
                </div>
              )}

              {/* Chat bubbles mapper */}
              {chatMessages.map((msg, index) => (
                <div key={index} className={`message-row ${msg.role}`}>
                  <div className="message-bubble">
                    {/* Render text with basic newlines */}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    
                    {/* Source Citations */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="citation-container">
                        <div className="citation-header-label">Sources Cited:</div>
                        {getUniqueSources(msg.sources).map((citation, cIdx) => (
                          <div 
                            key={cIdx} 
                            className={`citation-badge ${citation.video_id}`}
                            title={`"${citation.content}"`}
                          >
                            {citation.video_id === 'A' ? '🔴 Video A (YouTube)' : '🟣 Video B (Instagram Reel)'}
                            <span>@{citation.timestamp}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Live Streaming Token Output Bubble */}
              {isStreaming && (
                <div className="message-row assistant">
                  <div className="message-bubble streaming-cursor">
                    <div style={{ whiteSpace: 'pre-wrap' }}>{streamingContent}</div>
                    
                    {/* Show citations if they pop up early */}
                    {streamingSources.length > 0 && (
                      <div className="citation-container">
                        <div className="citation-header-label">Citing Context...</div>
                        {getUniqueSources(streamingSources).map((citation, cIdx) => (
                          <div key={cIdx} className={`citation-badge ${citation.video_id}`}>
                            {citation.video_id === 'A' ? '🔴 Video A' : '🟣 Video B'}
                            <span>@{citation.timestamp}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Error alerts */}
            {chatError && (
              <div className="alert-panel" style={{ margin: '0 1.5rem 0.5rem 1.5rem', background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                <span className="alert-icon" style={{ color: 'var(--accent-yt)' }}>⚠️</span>
                <div>{chatError}</div>
              </div>
            )}

            {/* Suggestion Presets */}
            {videoA && videoB && chatMessages.length === 0 && !isStreaming && (
              <div className="presets-container">
                <span className="preset-title">Preset Analyses</span>
                <div className="presets-grid">
                  {chatPresets.map((preset, index) => (
                    <button 
                      key={index} 
                      className="preset-btn" 
                      onClick={() => handleSendMessage(preset.text)}
                      disabled={!isIndexed}
                      title={preset.text}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat Input Bar */}
            <div className="chat-input-bar">
              <div className="chat-input-form">
                <input 
                  type="text" 
                  className="chat-input"
                  placeholder={
                    !isIndexed 
                      ? "Load and sync video data to unlock chat..." 
                      : "Ask about hooks, engagement differences, creator size..."
                  }
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!isIndexed || isStreaming}
                />
                <button 
                  className="send-btn" 
                  onClick={() => handleSendMessage()}
                  disabled={!isIndexed || isStreaming || !inputQuestion.trim()}
                >
                  ➔
                </button>
              </div>
            </div>

          </div>
        </section>

      </main>
    </div>
  );
}

// Deduplicate retrieved sources for beautiful source tags
function getUniqueSources(sources: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.video_id}-${s.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Settings modal sub-component
interface SettingsModalProps {
  currentProvider: string;
  currentKey: string;
  onClose: () => void;
  onSave: (provider: string, apiKey: string) => void;
}

function SettingsModal({ currentProvider, currentKey, onClose, onSave }: SettingsModalProps) {
  const [provider, setProvider] = useState(currentProvider);
  const [key, setKey] = useState(currentKey);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        
        <div className="modal-header">
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: '700' }}>AI Model Configurations</h3>
          <button className="close-modal-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="setting-row">
            <label className="meta-label">LLM Provider</label>
            <div className="api-source-selector">
              <label>
                <input 
                  type="radio" 
                  className="provider-radio" 
                  name="provider" 
                  value="local"
                  checked={provider === 'local'}
                  onChange={() => setProvider('local')}
                />
                <div className="provider-card">💻 Local Fallback</div>
              </label>
              
              <label>
                <input 
                  type="radio" 
                  className="provider-radio" 
                  name="provider" 
                  value="gemini"
                  checked={provider === 'gemini'}
                  onChange={() => setProvider('gemini')}
                />
                <div className="provider-card">♊ Gemini Flash</div>
              </label>

              <label>
                <input 
                  type="radio" 
                  className="provider-radio" 
                  name="provider" 
                  value="openai"
                  checked={provider === 'openai'}
                  onChange={() => setProvider('openai')}
                />
                <div className="provider-card">🤖 GPT-4o</div>
              </label>
            </div>
          </div>

          <div className="setting-row">
            <label className="meta-label">API Key (Optional for Local)</label>
            <input 
              type="password" 
              className="meta-input" 
              placeholder={
                provider === 'local' 
                  ? 'No API Key required for Local Fallback' 
                  : `Enter ${provider.toUpperCase()} API Key`
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={provider === 'local'}
            />
          </div>
          
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            {provider === 'local' ? (
              <span style={{ color: 'var(--accent-green)', fontWeight: '500' }}>
                ✓ Local fallback performs comprehensive semantic checks and rule-based comparisons completely offline and free. Perfect for immediate testing!
              </span>
            ) : (
              'Enter your paid API credentials above. Key will be saved only in your secure browser localStorage.'
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="sync-btn" style={{ background: 'transparent', borderColor: 'var(--border)' }} onClick={onClose}>
            Cancel
          </button>
          <button className="submit-btn" style={{ padding: '0.5rem 1rem' }} onClick={() => onSave(provider, key)}>
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
}
