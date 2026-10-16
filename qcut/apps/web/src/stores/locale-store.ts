import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AppLocale } from "@/lib/i18n/translations";

interface LocaleState {
	locale: AppLocale;
	setLocale: ({ locale }: { locale: AppLocale }) => void;
}

export const useLocaleStore = create<LocaleState>()(
	persist(
		(set) => ({
			locale: "zh",
			setLocale: ({ locale }) => set({ locale }),
		}),
		{
			name: "qcut-interface-language",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ locale }) => ({ locale }),
			version: 1,
		}
	)
);

// Expose for E2E fixtures, which pin the UI language per test.
(window as any).__localeStore = useLocaleStore;
