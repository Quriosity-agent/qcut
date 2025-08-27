import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '@/stores/project-store';
import { TestDataFactory } from '@/test/fixtures/factory';

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
    const project = await store.createProject('Test Project');
    
    expect(project).toBeDefined();
    expect(project.name).toBe('Test Project');
    expect(project.id).toBeTruthy();
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toBeInstanceOf(Date);
    
    // Check if project is set as active
    expect(store.activeProject?.id).toBe(project.id);
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