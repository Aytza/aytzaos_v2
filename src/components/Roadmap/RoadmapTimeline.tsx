import { useMemo, useCallback } from 'react';
import { useRoadmap } from '../../context/RoadmapContext';
import type { RoadmapItem, RoadmapColumn } from '../../types';
import { TEAM_MEMBERS } from '../../types';

// Get Monday of the week for a given date
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Generate array of weeks starting from current week
function generateWeeks(count: number): Date[] {
  const weeks: Date[] = [];
  const today = new Date();
  const currentWeekStart = getWeekStart(today);

  for (let i = 0; i < count; i++) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(currentWeekStart.getDate() + i * 7);
    weeks.push(weekStart);
  }

  return weeks;
}

function formatWeekHeader(date: Date): string {
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${month} ${day}`;
}

function isSameWeek(date1: Date, date2: Date): boolean {
  const week1 = getWeekStart(date1);
  const week2 = getWeekStart(date2);
  return week1.getTime() === week2.getTime();
}

function getOwnerInitials(email: string | null): string {
  if (!email) return '';
  const member = TEAM_MEMBERS.find((m) => m.email === email);
  if (member) {
    const parts = member.name.split(' ');
    return parts.map((p) => p[0]).join('').toUpperCase();
  }
  return email[0].toUpperCase();
}

const COLUMN_COLORS: Record<RoadmapColumn, string> = {
  ideas: '#6b7280',
  prototyping: '#f59e0b',
  building: '#3b82f6',
  shipped: '#10b981',
};

export function RoadmapTimeline() {
  const { state, selectItem, moveItem } = useRoadmap();
  const weeks = useMemo(() => generateWeeks(8), []);

  // Get items that have a target week and are in prototyping or building
  const scheduledItems = useMemo(() => {
    return state.items.filter(
      (item) => item.targetWeek && (item.column === 'prototyping' || item.column === 'building')
    );
  }, [state.items]);

  // Get items without target week
  const unscheduledItems = useMemo(() => {
    return state.items.filter(
      (item) => !item.targetWeek && (item.column === 'prototyping' || item.column === 'building')
    );
  }, [state.items]);

  const getItemsForWeek = useCallback(
    (week: Date): RoadmapItem[] => {
      return scheduledItems.filter((item) => {
        if (!item.targetWeek) return false;
        const itemDate = new Date(item.targetWeek);
        return isSameWeek(itemDate, week);
      });
    },
    [scheduledItems]
  );

  const handleDrop = useCallback(
    (_week: Date, e: React.DragEvent) => {
      e.preventDefault();
      const itemId = e.dataTransfer.getData('text/plain');
      if (!itemId) return;

      const item = state.items.find((i) => i.id === itemId);
      if (!item) return;

      // Note: Drag-drop on timeline just opens the modal for now
      // User can set target week via the modal
      moveItem(item.id, item.column, item.position);
    },
    [state.items, moveItem]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId);
  }, []);

  const today = new Date();
  const currentWeekStart = getWeekStart(today);

  return (
    <div className="roadmap-timeline">
      <div className="timeline-header">
        <div className="timeline-header-label">Week</div>
        {weeks.map((week) => (
          <div
            key={week.toISOString()}
            className={`timeline-header-week ${
              week.getTime() === currentWeekStart.getTime() ? 'current' : ''
            }`}
          >
            {formatWeekHeader(week)}
          </div>
        ))}
      </div>

      <div className="timeline-body">
        <div className="timeline-row-label">Scheduled</div>
        {weeks.map((week) => {
          const items = getItemsForWeek(week);
          return (
            <div
              key={week.toISOString()}
              className={`timeline-cell ${
                week.getTime() === currentWeekStart.getTime() ? 'current' : ''
              }`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(week, e)}
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  className="timeline-item"
                  style={{ borderLeftColor: COLUMN_COLORS[item.column] }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onClick={() => selectItem(item.id)}
                >
                  <div className="timeline-item-title">{item.title}</div>
                  <div className="timeline-item-meta">
                    <span
                      className="timeline-item-status"
                      style={{ backgroundColor: COLUMN_COLORS[item.column] }}
                    >
                      {item.column}
                    </span>
                    {item.ownerEmail && (
                      <span className="timeline-item-owner">
                        {getOwnerInitials(item.ownerEmail)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {unscheduledItems.length > 0 && (
        <div className="timeline-unscheduled">
          <h3>Unscheduled (in progress)</h3>
          <div className="timeline-unscheduled-items">
            {unscheduledItems.map((item) => (
              <div
                key={item.id}
                className="timeline-item"
                style={{ borderLeftColor: COLUMN_COLORS[item.column] }}
                draggable
                onDragStart={(e) => handleDragStart(e, item.id)}
                onClick={() => selectItem(item.id)}
              >
                <div className="timeline-item-title">{item.title}</div>
                <span
                  className="timeline-item-status"
                  style={{ backgroundColor: COLUMN_COLORS[item.column] }}
                >
                  {item.column}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
