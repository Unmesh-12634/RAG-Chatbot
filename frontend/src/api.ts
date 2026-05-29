export interface VideoData {
  platform: 'youtube' | 'instagram';
  video_id: string;
  title: string;
  creator: string;
  follower_count: number;
  views: number;
  likes: number;
  comments: number;
  engagement_rate: number;
  upload_date: string;
  duration: number;
  hashtags: string[];
  transcript: string;
  auto_fetch_success: boolean;
  message?: string;
}

export interface SourceCitation {
  content: string;
  video_id: 'A' | 'B';
  title: string;
  creator: string;
  timestamp: string;
  platform: 'youtube' | 'instagram';
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8001';

export async function fetchVideoMetadata(urlA: string, urlB: string): Promise<{ video_a: VideoData; video_b: VideoData }> {
  const response = await fetch(`${API_BASE}/api/fetch-metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url_a: urlA, url_b: urlB }),
  });

  if (!response.ok) {
    const err = await response.json();
    const errMsg = err.detail 
      ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail))
      : 'Failed to scrape metadata from server.';
    throw new Error(errMsg);
  }

  return response.json();
}

export async function indexVideosInDB(
  videoA: VideoData,
  videoB: VideoData,
  provider: string,
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/api/index-videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_a: videoA,
      video_b: videoB,
      provider,
      api_key: apiKey,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    const errMsg = err.detail 
      ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail))
      : 'Failed to index videos in Vector DB.';
    throw new Error(errMsg);
  }

  return response.json();
}

export async function streamChatResponse(
  question: string,
  provider: string,
  apiKey: string,
  onStart: (sources: SourceCitation[]) => void,
  onToken: (token: string) => void,
  onEnd: () => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        provider,
        api_key: apiKey,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      const errMsg = err.detail 
        ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail))
        : 'Failed to connect to chat agent.';
      throw new Error(errMsg);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      throw new Error('Response body is not readable.');
    }

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // Hold the last potentially partial block

      for (const part of parts) {
        if (!part.trim()) continue;

        const lines = part.split('\n');
        let eventType = '';
        let dataVal = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.substring(7).trim();
          } else if (line.startsWith('data: ')) {
            dataVal = line.substring(6).trim();
          }
        }

        if (eventType === 'start') {
          try {
            const sources = JSON.parse(dataVal);
            onStart(sources);
          } catch (e) {
            console.error('Error parsing sources JSON:', e);
          }
        } else if (eventType === 'token') {
          const cleanToken = dataVal.replace(/\\n/g, '\n');
          onToken(cleanToken);
        } else if (eventType === 'end') {
          onEnd();
        } else if (eventType === 'error') {
          try {
            const errObj = JSON.parse(dataVal);
            onError(errObj.error || 'Stream execution error');
          } catch {
            onError(dataVal);
          }
        }
      }
    }
  } catch (error: any) {
    onError(error.message || 'Network error occurred while fetching stream.');
  }
}
