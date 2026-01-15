/**
 * CompanyPipeline - Visual pipeline showing the scouting process
 *
 * Displays the three stages: Search → Verify → Score
 * with real-time counts and active indicators.
 */

import type { ScoutPhase, PipelineStats } from './types';
import './CompanyPipeline.css';

interface CompanyPipelineProps {
  phase: ScoutPhase;
  stats: PipelineStats;
}

export function CompanyPipeline({ phase, stats }: CompanyPipelineProps) {
  const isSearching = phase === 'searching';
  const isVerifying = phase === 'verifying' || stats.verifying > 0;
  const isScoring = phase === 'scoring' || stats.scoring > 0;
  const isComplete = phase === 'complete';

  // Determine stage statuses
  const getStageStatus = (stage: 'search' | 'verify' | 'score') => {
    switch (stage) {
      case 'search':
        if (isSearching) return 'active';
        if (stats.totalDiscovered > 0) return 'complete';
        return 'pending';
      case 'verify':
        if (isVerifying) return 'active';
        if (stats.verified > 0 && stats.verifying === 0) return 'complete';
        if (stats.totalDiscovered > 0) return 'pending';
        return 'disabled';
      case 'score':
        if (isScoring) return 'active';
        if (isComplete && stats.scored > 0) return 'complete';
        if (stats.verified > 0) return 'pending';
        return 'disabled';
    }
  };

  const searchStatus = getStageStatus('search');
  const verifyStatus = getStageStatus('verify');
  const scoreStatus = getStageStatus('score');

  return (
    <div className="company-pipeline">
      {/* Search stage */}
      <div className={`pipeline-stage ${searchStatus}`}>
        <div className="stage-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <div className="stage-content">
          <span className="stage-label">Search</span>
          <span className="stage-count">
            {stats.totalDiscovered > 0 ? (
              <>{stats.totalDiscovered} found</>
            ) : isSearching ? (
              'Searching...'
            ) : (
              '—'
            )}
          </span>
        </div>
        {searchStatus === 'active' && <div className="stage-pulse" />}
      </div>

      {/* Connector */}
      <div className={`pipeline-connector ${verifyStatus !== 'disabled' ? 'active' : ''}`}>
        <div className="connector-line" />
        <div className="connector-arrow">→</div>
      </div>

      {/* Verify stage */}
      <div className={`pipeline-stage ${verifyStatus}`}>
        <div className="stage-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 12l2 2 4-4" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
        <div className="stage-content">
          <span className="stage-label">Verify</span>
          <span className="stage-count">
            {stats.verifying > 0 ? (
              <>{stats.verifying} verifying</>
            ) : stats.verified > 0 ? (
              <>{stats.verified} verified</>
            ) : verifyStatus === 'disabled' ? (
              '—'
            ) : (
              'Waiting...'
            )}
          </span>
        </div>
        {verifyStatus === 'active' && <div className="stage-pulse" />}
      </div>

      {/* Connector */}
      <div className={`pipeline-connector ${scoreStatus !== 'disabled' ? 'active' : ''}`}>
        <div className="connector-line" />
        <div className="connector-arrow">→</div>
      </div>

      {/* Score stage */}
      <div className={`pipeline-stage ${scoreStatus}`}>
        <div className="stage-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        </div>
        <div className="stage-content">
          <span className="stage-label">Score</span>
          <span className="stage-count">
            {stats.scoring > 0 ? (
              <>{stats.scoring} scoring</>
            ) : stats.scored > 0 ? (
              <>{stats.included} included</>
            ) : scoreStatus === 'disabled' ? (
              '—'
            ) : (
              'Waiting...'
            )}
          </span>
        </div>
        {scoreStatus === 'active' && <div className="stage-pulse" />}
      </div>

      {/* Final indicator when complete */}
      {isComplete && (
        <div className="pipeline-complete">
          <div className="complete-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20,6 9,17 4,12" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
