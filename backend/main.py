import json
import traceback
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

from scraper import scrape_youtube, scrape_instagram
from rag import VideoRAGManager

app = FastAPI(title="RAG Creator Studio Backend")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize RAG manager
rag_manager = VideoRAGManager()

# Input validation models
class FetchUrlsRequest(BaseModel):
    url_a: str = Field(..., description="YouTube URL")
    url_b: str = Field(..., description="Instagram Reel URL")

class VideoData(BaseModel):
    platform: str
    video_id: str
    title: Optional[str] = "Unknown Title"
    creator: Optional[str] = "Unknown Creator"
    follower_count: Optional[float] = 0.0
    views: Optional[float] = 0.0
    likes: Optional[float] = 0.0
    comments: Optional[float] = 0.0
    engagement_rate: Optional[float] = 0.0
    upload_date: Optional[str] = ""
    duration: Optional[float] = 0.0
    hashtags: Optional[List[str]] = []
    transcript: Optional[str] = ""
    auto_fetch_success: Optional[bool] = True
    message: Optional[str] = None

class IndexRequest(BaseModel):
    video_a: VideoData
    video_b: VideoData
    provider: str
    api_key: Optional[str] = ""

class ChatRequest(BaseModel):
    question: str
    provider: str
    api_key: Optional[str] = ""


@app.get("/")
def read_root():
    return {"status": "healthy", "service": "RAG Creator Studio Backend API"}


@app.post("/api/fetch-metadata")
def fetch_metadata(request: FetchUrlsRequest):
    """Fetch metadata and transcripts for both YouTube (Video A) and Instagram (Video B)."""
    try:
        url_a = request.url_a.strip()
        url_b = request.url_b.strip()

        if not url_a or not url_b:
            raise HTTPException(status_code=400, detail="Both video URLs are required.")

        import concurrent.futures
        print(f"Initiating concurrent metadata extraction for Video A and Video B...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(scrape_youtube, url_a)
            future_b = executor.submit(scrape_instagram, url_b)
            video_a_data = future_a.result()
            video_b_data = future_b.result()

        return {
            "video_a": video_a_data,
            "video_b": video_b_data
        }

    except Exception as e:
        print(f"Error fetching metadata: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch metadata: {str(e)}")


@app.post("/api/index-videos")
def index_videos(request: IndexRequest):
    """Index transcripts in the local vector DB with metadata."""
    try:
        video_a = request.video_a.model_dump()
        video_b = request.video_b.model_dump()
        provider = request.provider
        api_key = request.api_key

        success = rag_manager.index_videos(video_a, video_b, provider, api_key)
        
        if success:
            return {
                "success": True, 
                "message": "Transcripts successfully chunked, embedded, and indexed in Chroma Vector DB!"
            }
        else:
            raise HTTPException(status_code=500, detail="Vector indexing failed.")

    except Exception as e:
        print(f"Error indexing videos: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to index transcripts: {str(e)}")


@app.post("/api/chat")
def chat(request: ChatRequest):
    """Chat endpoint supporting SSE token streaming and citations."""
    question = request.question.strip()
    provider = request.provider
    api_key = request.api_key

    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if not rag_manager.vector_store:
        raise HTTPException(status_code=400, detail="Vector database has not been initialized. Please index the videos first.")

    def event_generator():
        llm_response_buffer = []
        try:
            for event in rag_manager.run_rag_stream(question, provider, api_key):
                if event["type"] == "start":
                    sources_json = json.dumps(event["sources"])
                    yield f"event: start\ndata: {sources_json}\n\n"
                elif event["type"] == "token":
                    text = event["text"]
                    llm_response_buffer.append(text)
                    # Escape newline characters to prevent splitting SSE packets incorrectly
                    escaped_text = text.replace("\n", "\\n")
                    yield f"event: token\ndata: {escaped_text}\n\n"
                elif event["type"] == "end":
                    # Store completed response in history
                    full_response = "".join(llm_response_buffer)
                    rag_manager.chat_history.append({"role": "assistant", "content": full_response})
                    yield "event: end\ndata: \n\n"
        except Exception as e:
            print(f"Error during stream generation: {e}")
            traceback.print_exc()
            error_data = json.dumps({"error": str(e)})
            yield f"event: error\ndata: {error_data}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
