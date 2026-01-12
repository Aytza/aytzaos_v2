import { useState } from 'react';
import { RoadmapProvider } from '../../context/RoadmapContext';
import { RoadmapBoard } from './RoadmapBoard';
import { RoadmapTimeline } from './RoadmapTimeline';
import { RoadmapItemModal } from './RoadmapItemModal';
import './Roadmap.css';

type ViewMode = 'board' | 'timeline';

function RoadmapContent() {
  const [viewMode, setViewMode] = useState<ViewMode>('board');

  return (
    <div className="roadmap">
      <div className="roadmap-header">
        <h1>Product Roadmap</h1>
        <div className="roadmap-view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'board' ? 'active' : ''}`}
            onClick={() => setViewMode('board')}
          >
            Board
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
            onClick={() => setViewMode('timeline')}
          >
            Timeline
          </button>
        </div>
      </div>

      <div className="roadmap-content">
        {viewMode === 'board' ? <RoadmapBoard /> : <RoadmapTimeline />}
      </div>

      <RoadmapItemModal />
    </div>
  );
}

export function Roadmap() {
  return (
    <RoadmapProvider>
      <RoadmapContent />
    </RoadmapProvider>
  );
}
