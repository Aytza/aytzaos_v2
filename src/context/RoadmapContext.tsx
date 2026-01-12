import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { RoadmapItem, RoadmapColumn, ItemSize } from '../types';
import * as api from '../api/client';

// ============================================
// STATE
// ============================================

interface RoadmapState {
  items: RoadmapItem[];
  loading: boolean;
  error: string | null;
  selectedItemId: string | null;
}

const initialState: RoadmapState = {
  items: [],
  loading: false,
  error: null,
  selectedItemId: null,
};

// ============================================
// ACTIONS
// ============================================

type RoadmapAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_ITEMS'; payload: RoadmapItem[] }
  | { type: 'ADD_ITEM'; payload: RoadmapItem }
  | { type: 'UPDATE_ITEM'; payload: RoadmapItem }
  | { type: 'DELETE_ITEM'; payload: string }
  | { type: 'SET_SELECTED_ITEM'; payload: string | null };

function roadmapReducer(state: RoadmapState, action: RoadmapAction): RoadmapState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_ITEMS':
      return { ...state, items: action.payload, loading: false };
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.payload] };
    case 'UPDATE_ITEM':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.payload.id ? action.payload : item
        ),
      };
    case 'DELETE_ITEM':
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.payload),
        selectedItemId: state.selectedItemId === action.payload ? null : state.selectedItemId,
      };
    case 'SET_SELECTED_ITEM':
      return { ...state, selectedItemId: action.payload };
    default:
      return state;
  }
}

// ============================================
// CONTEXT
// ============================================

interface RoadmapContextValue {
  state: RoadmapState;
  loadItems: () => Promise<void>;
  createItem: (data: {
    title: string;
    description?: string;
    column?: RoadmapColumn;
    ownerEmail?: string;
    startDate?: string;
    endDate?: string;
    size?: ItemSize;
    notes?: string;
  }) => Promise<RoadmapItem | null>;
  updateItem: (
    id: string,
    data: {
      title?: string;
      description?: string;
      ownerEmail?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      size?: ItemSize;
      notes?: string | null;
    }
  ) => Promise<RoadmapItem | null>;
  moveItem: (id: string, column: RoadmapColumn, position: number) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  selectItem: (id: string | null) => void;
  getItemsByColumn: (column: RoadmapColumn) => RoadmapItem[];
}

const RoadmapContext = createContext<RoadmapContextValue | null>(null);

// ============================================
// PROVIDER
// ============================================

export function RoadmapProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roadmapReducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);

  // Load items on mount
  const loadItems = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    const result = await api.getRoadmapItems();
    if (result.success && result.data) {
      dispatch({ type: 'SET_ITEMS', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to load items' });
    }
  }, []);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/roadmap/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'roadmap_item_created' && message.data.item) {
          dispatch({ type: 'ADD_ITEM', payload: message.data.item });
        } else if (message.type === 'roadmap_item_updated' && message.data.item) {
          dispatch({ type: 'UPDATE_ITEM', payload: message.data.item });
        } else if (message.type === 'roadmap_item_moved' && message.data.item) {
          // Reload all items to get correct positions
          loadItems();
        } else if (message.type === 'roadmap_item_deleted' && message.data.id) {
          dispatch({ type: 'DELETE_ITEM', payload: message.data.id });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onopen = () => {
      // Start ping interval
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
      ws.addEventListener('close', () => clearInterval(pingInterval));
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [loadItems]);

  // Load items on mount
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const createItem = useCallback(async (data: {
    title: string;
    description?: string;
    column?: RoadmapColumn;
    ownerEmail?: string;
    startDate?: string;
    endDate?: string;
    size?: ItemSize;
    notes?: string;
  }) => {
    const result = await api.createRoadmapItem(data);
    if (result.success && result.data) {
      // Don't dispatch ADD_ITEM here - WebSocket will handle it
      // to avoid duplicate items
      return result.data;
    }
    return null;
  }, []);

  const updateItem = useCallback(async (
    id: string,
    data: {
      title?: string;
      description?: string;
      ownerEmail?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      size?: ItemSize;
      notes?: string | null;
    }
  ) => {
    const result = await api.updateRoadmapItem(id, data);
    if (result.success && result.data) {
      dispatch({ type: 'UPDATE_ITEM', payload: result.data });
      return result.data;
    }
    return null;
  }, []);

  const moveItem = useCallback(async (id: string, column: RoadmapColumn, position: number) => {
    // Optimistic update
    const item = state.items.find((i) => i.id === id);
    if (item) {
      dispatch({ type: 'UPDATE_ITEM', payload: { ...item, column, position } });
    }

    const result = await api.moveRoadmapItem(id, column, position);
    if (!result.success) {
      // Revert on failure
      loadItems();
    }
  }, [state.items, loadItems]);

  const deleteItem = useCallback(async (id: string) => {
    const result = await api.deleteRoadmapItem(id);
    if (result.success) {
      dispatch({ type: 'DELETE_ITEM', payload: id });
    }
  }, []);

  const selectItem = useCallback((id: string | null) => {
    dispatch({ type: 'SET_SELECTED_ITEM', payload: id });
  }, []);

  const getItemsByColumn = useCallback((column: RoadmapColumn) => {
    return state.items
      .filter((item) => item.column === column)
      .sort((a, b) => a.position - b.position);
  }, [state.items]);

  return (
    <RoadmapContext.Provider
      value={{
        state,
        loadItems,
        createItem,
        updateItem,
        moveItem,
        deleteItem,
        selectItem,
        getItemsByColumn,
      }}
    >
      {children}
    </RoadmapContext.Provider>
  );
}

export function useRoadmap() {
  const context = useContext(RoadmapContext);
  if (!context) {
    throw new Error('useRoadmap must be used within a RoadmapProvider');
  }
  return context;
}
