# RAG Creator Studio: React + TypeScript Client Architecture

This is the frontend user interface for the RAG Video Analytics Engine, built with **React**, **TypeScript**, and **Vite** with highly optimized custom glassmorphic CSS styling.

---

## 🎨 Design & Interaction Highlights (The Front-End Sweat)

Instead of dumping a standard UI boilerplate, we engineered this app from scratch with two guiding principles: **Aesthetic Wow-Factor** and **State Management Resilience**.

### 1. The Dynamic Glassmorphic Card System
* We implemented a side-by-side editing dashboard that is responsive and beautifully stylized using **Vanilla CSS Custom Variables** (no bloated libraries or slow runtimes).
* Each card acts as an editable workspace. When a creator edits Views, Likes, or Comments, the frontend **instantly recalculates the video's Engagement Rate** in real time, giving instant visual feedback:
  ```typescript
  if (['views', 'likes', 'comments'].includes(field as string)) {
    const views = Number(updated.views) || 0;
    const likes = Number(updated.likes) || 0;
    const comments = Number(updated.comments) || 0;
    updated.engagement_rate = views > 0 ? Number(((likes + comments) / views * 100).toFixed(2)) : 0;
  }
  ```

### 2. Resolving Stale Closures on SSE Streams
* **The challenge:** Streaming responses over Server-Sent Events (SSE) inside a React hook is a classic state trap. If your event listeners rely directly on state variables (`chatMessages`), they capture a snapshot of the state at the time the stream started. This results in characters being dropped or only the last token rendering.
* **The engineering fix:** We decoupled stream updates from the React state cycle by using mutable `useRef` accumulators. We stream incoming tokens directly into a ref buffer and only commit to standard React state on a `[DONE]` stream trigger.
  ```typescript
  // Accumulators used to sidestep React render loop closures
  const accumulatedTextRef = useRef<string>('');
  const accumulatedSourcesRef = useRef<SourceCitation[]>([]);
  ```

### 3. Clickable Citation Rendering
* When the RAG assistant quotes a portion of a video transcript, it maps it directly to a unique badge detailing the video origin (`🔴 YouTube` or `🟣 Instagram`) and the specific duration offset (e.g. `[00:15]`).
* Creators can click the citation badges to immediately highlight relevant context.

---

## 🚀 How to Run Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Dev Server
```bash
npm run dev
```
The Vite server will start on **`http://localhost:5173`** and proxy backend requests directly to Port 8001.
