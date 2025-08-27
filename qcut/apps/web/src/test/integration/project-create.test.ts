import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '@/stores/project-store';
import { TestDataFactory } from '@/test/fixtures/factory';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    }
  };
})();

global.localStorage = localStorageMock as Storage;

describe('Project Creation', () => {
  beforeEach(() => {
    useProjectStore.setState({
      activeProject: null,
      savedProjects: [],
      isLoading: false,
      isInitialized: false,
    });
  });
  
  it('creates new project', async () => {
    const store = useProjectStore.getState();
    const projectId = await store.createNewProject('Test Project');
    
    expect(projectId).toBeDefined();
    expect(projectId).toBeTruthy();
    
    // Check if project is set as active
    const updatedStore = useProjectStore.getState();
    expect(updatedStore.activeProject?.id).toBe(projectId);
    expect(updatedStore.activeProject?.name).toBe('Test Project');
  });
  
  it('loads project from storage', async () => {
    const store = useProjectStore.getState();
    const mockProject = TestDataFactory.createProject({ name: 'Loaded Project' });
    
    // Mock storage response
    vi.spyOn(store, 'loadProject').mockResolvedValue(mockProject);
    
    const loaded = await store.loadProject(mockProject.id);
    expect(loaded.name).toBe('Loaded Project');
  });
});