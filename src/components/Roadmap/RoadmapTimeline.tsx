import { useMemo, useCallback } from 'react';
import { useRoadmap } from '../../context/RoadmapContext';
import type { RoadmapItem, RoadmapColumn } from '../../types';
import { TEAM_MEMBERS } from '../../types';

// Generate array of days for the timeline
function generateDays(startDate: Date, count: number): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + i);
    days.push(day);
  }
  return days;
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

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

const COLUMN_COLORS: Record<RoadmapColumn, string> = {
  ideas: '#888888',
  prototyping: '#f59e0b',
  building: '#3b82f6',
  shipped: '#10b981',
};

const TIMELINE_DAYS = 60; // Show 60 days

export function RoadmapTimeline() {
  const { state, selectItem } = useRoadmap();

  // Generate days starting from 7 days ago
  const timelineStart = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return start;
  }, []);

  const days = useMemo(() => generateDays(timelineStart, TIMELINE_DAYS), [timelineStart]);
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // Get items that have dates set
  const scheduledItems = useMemo(() => {
    return state.items.filter((item) => item.startDate || item.endDate);
  }, [state.items]);

  // Get items without dates
  const unscheduledItems = useMemo(() => {
    return state.items.filter((item) => !item.startDate && !item.endDate);
  }, [state.items]);

  // Calculate bar position and width for an item
  const getItemBarStyle = useCallback(
    (item: RoadmapItem): { left: string; width: string } | null => {
      const startDate = item.startDate ? new Date(item.startDate) : null;
      const endDate = item.endDate ? new Date(item.endDate) : null;

      if (!startDate && !endDate) return null;

      const timelineEnd = new Date(timelineStart);
      timelineEnd.setDate(timelineStart.getDate() + TIMELINE_DAYS);

      // Use startDate or today if only endDate is set
      const barStart = startDate || today;
      // Use endDate or startDate + 7 days if only startDate is set
      const barEnd = endDate || new Date(barStart.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Calculate position
      const dayWidth = 100 / TIMELINE_DAYS;
      const startDiff = Math.floor(
        (barStart.getTime() - timelineStart.getTime()) / (24 * 60 * 60 * 1000)
      );
      const duration = Math.ceil(
        (barEnd.getTime() - barStart.getTime()) / (24 * 60 * 60 * 1000)
      ) + 1;

      const left = Math.max(0, startDiff) * dayWidth;
      const width = Math.min(duration, TIMELINE_DAYS - startDiff) * dayWidth;

      if (width <= 0 || left >= 100) return null;

      return {
        left: `${left}%`,
        width: `${Math.max(width, dayWidth)}%`,
      };
    },
    [timelineStart, today]
  );

  // Group months for header
  const months = useMemo(() => {
    const monthGroups: { month: string; days: number; startIndex: number }[] = [];
    let currentMonth = '';
    let currentCount = 0;
    let startIndex = 0;

    days.forEach((day, index) => {
      const month = day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (month !== currentMonth) {
        if (currentMonth) {
          monthGroups.push({ month: currentMonth, days: currentCount, startIndex });
        }
        currentMonth = month;
        currentCount = 1;
        startIndex = index;
      } else {
        currentCount++;
      }
    });
    if (currentMonth) {
      monthGroups.push({ month: currentMonth, days: currentCount, startIndex });
    }
    return monthGroups;
  }, [days]);

  return (
    <div className="roadmap-timeline-gantt">
      {/* Month headers */}
      <div className="gantt-months">
        <div className="gantt-row-label" />
        {months.map((m) => (
          <div
            key={`${m.month}-${m.startIndex}`}
            className="gantt-month"
            style={{ width: `${(m.days / TIMELINE_DAYS) * 100}%` }}
          >
            {m.month}
          </div>
        ))}
      </div>

      {/* Day headers */}
      <div className="gantt-days">
        <div className="gantt-row-label" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`gantt-day ${isSameDay(day, today) ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}`}
          >
            {day.getDate()}
          </div>
        ))}
      </div>

      {/* Items */}
      <div className="gantt-rows">
        {scheduledItems.map((item) => {
          const barStyle = getItemBarStyle(item);
          return (
            <div key={item.id} className="gantt-row">
              <div className="gantt-row-label" onClick={() => selectItem(item.id)}>
                <span className="gantt-item-title">{item.title}</span>
                {item.ownerEmail && (
                  <span className="gantt-item-owner">{getOwnerInitials(item.ownerEmail)}</span>
                )}
              </div>
              <div className="gantt-row-track">
                {/* Grid lines for days */}
                {days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={`gantt-grid-cell ${isSameDay(day, today) ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}`}
                  />
                ))}
                {/* The bar */}
                {barStyle && (
                  <div
                    className="gantt-bar"
                    style={{
                      ...barStyle,
                      backgroundColor: COLUMN_COLORS[item.column],
                    }}
                    onClick={() => selectItem(item.id)}
                    title={`${item.title}\n${item.startDate || ''} - ${item.endDate || ''}`}
                  >
                    <span className="gantt-bar-label">{item.title}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Today marker */}
      <div
        className="gantt-today-line"
        style={{
          left: `calc(${((today.getTime() - timelineStart.getTime()) / (TIMELINE_DAYS * 24 * 60 * 60 * 1000)) * 100}% + 120px)`,
        }}
      />

      {/* Unscheduled items */}
      {unscheduledItems.length > 0 && (
        <div className="gantt-unscheduled">
          <h3>Unscheduled Items</h3>
          <div className="gantt-unscheduled-items">
            {unscheduledItems.map((item) => (
              <div
                key={item.id}
                className="gantt-unscheduled-item"
                style={{ borderLeftColor: COLUMN_COLORS[item.column] }}
                onClick={() => selectItem(item.id)}
              >
                <span className="gantt-item-title">{item.title}</span>
                <span
                  className="gantt-item-status"
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
