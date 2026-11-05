import { create } from "zustand";

export const useLegacyRecovery = create<{ open: (() => void) | undefined }>(() => ({ open: undefined }));
