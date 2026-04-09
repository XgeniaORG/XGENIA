import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ProjectStyleState {
    baseStyleImageId: string | null;
    baseStyleImageUrl: string | null;
    globalStylePrompt: string;

    setBaseStyle: (id: string, url: string) => void;
    clearBaseStyle: () => void;
    setGlobalStylePrompt: (prompt: string) => void;
}

export const useProjectStylesStore = create<ProjectStyleState>()(
    devtools(
        (set) => ({
            baseStyleImageId: null,
            baseStyleImageUrl: null,
            globalStylePrompt: '',

            setBaseStyle: (id, url) => set({ baseStyleImageId: id, baseStyleImageUrl: url }),
            clearBaseStyle: () => set({ baseStyleImageId: null, baseStyleImageUrl: null }),
            setGlobalStylePrompt: (prompt) => set({ globalStylePrompt: prompt }),
        }),
        { name: 'project-styles-store' }
    )
);
