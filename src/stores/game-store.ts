import { create } from "zustand";
import type { GameState } from "@/types/game";

interface GameStore {
  gameState: GameState | null;
  isLoading: boolean;
  error: string | null;

  setGameState: (state: GameState) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  advanceStep: () => void;
  incrementHints: () => void;
  complete: () => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  gameState: null,
  isLoading: false,
  error: null,

  setGameState: (gameState) => set({ gameState, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  advanceStep: () =>
    set((state) => {
      if (!state.gameState) return state;
      return {
        gameState: {
          ...state.gameState,
          currentStep: state.gameState.currentStep + 1,
        },
      };
    }),

  incrementHints: () =>
    set((state) => {
      if (!state.gameState) return state;
      return {
        gameState: {
          ...state.gameState,
          hintsUsed: state.gameState.hintsUsed + 1,
        },
      };
    }),

  complete: () =>
    set((state) => {
      if (!state.gameState) return state;
      return {
        gameState: {
          ...state.gameState,
          status: "completed" as const,
        },
      };
    }),

  reset: () => set({ gameState: null, isLoading: false, error: null }),
}));
