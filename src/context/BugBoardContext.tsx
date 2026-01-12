import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { BugItem, BugColumn, BugSeverity } from '../types';
import * as api from '../api/client';

// ============================================
// STATE
// ============================================

interface BugBoardState {
  items: BugItem[];
  loading: boolean;
  error: string | null;
  selectedItemId: string | null;
}

const initialState: BugBoardState = {
  items: [],
  loading: false,
  error: null,
  selectedItemId: null,
};

// ============================================
// ACTIONS
// ============================================

type BugBoardAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_ITEMS'; payload: BugItem[] }
  | { type: 'ADD_ITEM'; payload: BugItem }
  | { type: 'UPDATE_ITEM'; payload: BugItem }
  | { type: 'DELETE_ITEM'; payload: string }
  | { type: 'SET_SELECTED_ITEM'; payload: string | null };

function bugBoardReducer(state: BugBoardState, action: BugBoardAction): BugBoardState {
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

interface BugBoardContextValue {
  state: BugBoardState;
  loadItems: () => Promise<void>;
  createItem: (data: {
    title: string;
    description?: string;
    column?: BugColumn;
    severity?: BugSeverity;
    ownerEmail?: string;
  }) => Promise<BugItem | null>;
  updateItem: (
    id: string,
    data: {
      title?: string;
      description?: string;
      severity?: BugSeverity;
      ownerEmail?: string | null;
      screenshots?: string[];
    }
  ) => Promise<BugItem | null>;
  moveItem: (id: string, column: BugColumn, position: number) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  selectItem: (id: string | null) => void;
  getItemsByColumn: (column: BugColumn) => BugItem[];
}

const BugBoardContext = createContext<BugBoardContextValue | null>(null);

// ============================================
// PROVIDER
// ============================================

export function BugBoardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(bugBoardReducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);

  const loadItems = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    const result = await api.getBugItems();
    if (result.success && result.data) {
      dispatch({ type: 'SET_ITEMS', payload: result.data });
    } else {
      dispatch({ type: 'SET_ERROR', payload: result.error?.message || 'Failed to load items' });
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/bugs/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'bug_item_created' && message.data.item) {
          dispatch({ type: 'ADD_ITEM', payload: message.data.item });
        } else if (message.type === 'bug_item_updated' && message.data.item) {
          dispatch({ type: 'UPDATE_ITEM', payload: message.data.item });
        } else if (message.type === 'bug_item_moved' && message.data.item) {
          loadItems();
        } else if (message.type === 'bug_item_deleted' && message.data.id) {
          dispatch({ type: 'DELETE_ITEM', payload: message.data.id });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onopen = () => {
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

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const createItem = useCallback(async (data: {
    title: string;
    description?: string;
    column?: BugColumn;
    severity?: BugSeverity;
    ownerEmail?: string;
  }) => {
    const result = await api.createBugItem(data);
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
      severity?: BugSeverity;
      ownerEmail?: string | null;
      screenshots?: string[];
    }
  ) => {
    const result = await api.updateBugItem(id, data);
    if (result.success && result.data) {
      dispatch({ type: 'UPDATE_ITEM', payload: result.data });
      return result.data;
    }
    return null;
  }, []);

  const moveItem = useCallback(async (id: string, column: BugColumn, position: number) => {
    const item = state.items.find((i) => i.id === id);
    if (item) {
      dispatch({ type: 'UPDATE_ITEM', payload: { ...item, column, position } });
    }

    const result = await api.moveBugItem(id, column, position);
    if (!result.success) {
      loadItems();
    }
  }, [state.items, loadItems]);

  const deleteItem = useCallback(async (id: string) => {
    const result = await api.deleteBugItem(id);
    if (result.success) {
      dispatch({ type: 'DELETE_ITEM', payload: id });
    }
  }, []);

  const selectItem = useCallback((id: string | null) => {
    dispatch({ type: 'SET_SELECTED_ITEM', payload: id });
  }, []);

  const getItemsByColumn = useCallback((column: BugColumn) => {
    return state.items
      .filter((item) => item.column === column)
      .sort((a, b) => a.position - b.position);
  }, [state.items]);

  return (
    <BugBoardContext.Provider
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
    </BugBoardContext.Provider>
  );
}

export function useBugBoard() {
  const context = useContext(BugBoardContext);
  if (!context) {
    throw new Error('useBugBoard must be used within a BugBoardProvider');
  }
  return context;
}
