import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '@/stores/project-store';
import { TestDataFactory } from '@/test/fixtures/factory';
import { waitFor } from '@testing-library/react';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      const { [key]: _omitted, ...rest } = store;
      store = rest;
    }
  };
})();

global.localStorage = localStorageMock as Storage;

describe('Project Creation', () => {
  beforeEach(() => {
    useProjectStore.setState({
      activeProject: null,
      savedProjects: [],
      isLoading: true,
      isInitialized: false,
      invalidProjectIds: new Set<string>(),
    });
    localStorageMock.clear();
  });
  
  it('creates new project', async () => {
    const store = useProjectStore.getState();
    
    // Create the project
    const projectIdPromise = store.createNewProject('Test Project');
    
    // Wait for the project to be created with a longer timeout
    const projectId = await waitFor(
      async () => {
        const id = await projectIdPromise;
        expect(id).toBeDefined();
        return id;
      },
      { timeout: 10000 } // 10 second timeout
    );
    
    expect(projectId).toBeTruthy();
    
    // Check if project is set as active
    await waitFor(() => {
      const updatedStore = useProjectStore.getState();
      expect(updatedStore.activeProject?.id).toBe(projectId);
      expect(updatedStore.activeProject?.name).toBe('Test Project');
    });
  }, 10000); // Set test timeout to 10 seconds
  
  it('loads project from storage', async () => {
    const mockProject = TestDataFactory.createProject({ 
      id: 'test-project-id',
      name: 'Loaded Project' 
    });
    
    // Store the project in mock localStorage
    const projectsData = { [mockProject.id]: mockProject };
    localStorageMock.setItem(
      'video-editor-projects_projects_list',
      JSON.stringify(projectsData)
    );
    
    // Load the project
    const store = useProjectStore.getState();
    await store.loadProject(mockProject.id);
    
    // Check if project is loaded
    await waitFor(() => {
      const updatedStore = useProjectStore.getState();
      expect(updatedStore.activeProject?.id).toBe(mockProject.id);
      expect(updatedStore.activeProject?.name).toBe('Loaded Project');
    });
  });
});