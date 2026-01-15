/**
 * CompanyResultsGrid - Displays companies as they stream in
 *
 * Shows companies in a visual grid with real-time status updates.
 * Companies animate in as they're discovered, verified, and scored.
 */

import { useState, useMemo } from 'react';
import type { Company, ScoutPhase } from './types';
import './CompanyResultsGrid.css';

interface CompanyResultsGridProps {
  companies: Company[];
  isLoading: boolean;
  phase: ScoutPhase;
}

type FilterType = 'all' | 'included' | 'excluded';

export function CompanyResultsGrid({
  companies,
  isLoading,
  phase,
}: CompanyResultsGridProps) {
  const [filter, setFilter] = useState<FilterType>('all');

  // Sort and filter companies
  const { includedCompanies, excludedCompanies, displayedCompanies } = useMemo(() => {
    const sorted = [...companies].sort((a, b) => {
      // Sort by score descending (nulls last)
      if (a.fitScore === null && b.fitScore === null) return 0;
      if (a.fitScore === null) return 1;
      if (b.fitScore === null) return -1;
      return b.fitScore - a.fitScore;
    });

    const included = sorted.filter(c => c.fitScore !== null && c.fitScore >= 5);
    const excluded = sorted.filter(c => c.fitScore !== null && c.fitScore < 5);

    let displayed: Company[];
    switch (filter) {
      case 'included':
        displayed = included;
        break;
      case 'excluded':
        displayed = excluded;
        break;
      default:
        displayed = sorted;
    }

    return { includedCompanies: included, excludedCompanies: excluded, displayedCompanies: displayed };
  }, [companies, filter]);

  const getStatusBadge = (company: Company) => {
    switch (company.status) {
      case 'discovered':
        return <span className="company-badge badge-discovered">Discovered</span>;
      case 'verifying':
        return <span className="company-badge badge-verifying">Verifying...</span>;
      case 'verified':
        return <span className="company-badge badge-verified">Verified</span>;
      case 'scoring':
        return <span className="company-badge badge-scoring">Scoring...</span>;
      case 'scored':
        return null; // Score shows instead
      case 'error':
        return <span className="company-badge badge-error">Error</span>;
      default:
        return null;
    }
  };

  const getScoreBadge = (score: number) => {
    if (score >= 8) return 'score-excellent';
    if (score >= 6) return 'score-good';
    if (score >= 5) return 'score-ok';
    return 'score-low';
  };

  if (companies.length === 0 && !isLoading) {
    return (
      <div className="company-grid-empty">
        <div className="company-grid-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <p>No companies found yet</p>
      </div>
    );
  }

  return (
    <div className="company-results-grid">
      {/* Filter tabs */}
      {companies.some(c => c.fitScore !== null) && (
        <div className="company-grid-filters">
          <button
            className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({companies.length})
          </button>
          <button
            className={`filter-tab ${filter === 'included' ? 'active' : ''}`}
            onClick={() => setFilter('included')}
          >
            Included ({includedCompanies.length})
          </button>
          <button
            className={`filter-tab ${filter === 'excluded' ? 'active' : ''}`}
            onClick={() => setFilter('excluded')}
          >
            Excluded ({excludedCompanies.length})
          </button>
        </div>
      )}

      {/* Company grid */}
      <div className="company-grid">
        {displayedCompanies.map((company) => (
          <div
            key={company.id}
            className={`company-card ${company.status} ${
              company.fitScore !== null && company.fitScore < 5 ? 'excluded' : ''
            }`}
          >
            <div className="company-card-header">
              <div className="company-name-row">
                <h3 className="company-name">{company.name}</h3>
                {company.fitScore !== null ? (
                  <div className={`company-score ${getScoreBadge(company.fitScore)}`}>
                    <span className="score-value">{company.fitScore}</span>
                    <span className="score-label">/10</span>
                  </div>
                ) : (
                  getStatusBadge(company)
                )}
              </div>
              <a
                href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="company-website"
              >
                {company.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15,3 21,3 21,9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>

            <div className="company-card-body">
              <p className="company-reasoning">{company.reasoning}</p>
            </div>

            {company.error && (
              <div className="company-card-error">
                <span className="error-icon">!</span>
                {company.error}
              </div>
            )}
          </div>
        ))}

        {/* Loading placeholder cards */}
        {isLoading && (
          <>
            <div className="company-card placeholder">
              <div className="placeholder-shimmer" />
            </div>
            <div className="company-card placeholder">
              <div className="placeholder-shimmer" />
            </div>
          </>
        )}
      </div>

      {/* Results summary */}
      {phase === 'complete' && companies.length > 0 && (
        <div className="company-results-summary">
          <p>
            Found <strong>{includedCompanies.length}</strong> matching companies
            {excludedCompanies.length > 0 && (
              <> ({excludedCompanies.length} excluded with score &lt; 5)</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
