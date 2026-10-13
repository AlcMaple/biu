import { createContext, use } from "react";

interface SideDrawerContextValue {
  openSideDrawer: () => void;
  closeSideDrawer: () => void;
}

export const SideDrawerContext = createContext<SideDrawerContextValue | null>(null);

export const useSideDrawer = () => use(SideDrawerContext);
