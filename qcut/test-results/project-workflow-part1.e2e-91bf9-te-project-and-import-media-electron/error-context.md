# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - link "Back" [ref=e5] [cursor=pointer]:
      - /url: /index.html#/
      - img [ref=e6] [cursor=pointer]
      - generic [ref=e8] [cursor=pointer]: Back
    - main [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]:
          - heading "Your Projects" [level=1] [ref=e12]
          - paragraph [ref=e13]: 0 projects
        - generic [ref=e15]:
          - button "Select Projects" [disabled]
          - button "New project" [ref=e16] [cursor=pointer]:
            - img
            - generic [ref=e17] [cursor=pointer]: New project
      - generic [ref=e18]:
        - textbox "Search projects..." [ref=e21]
        - combobox [ref=e22]:
          - generic: Newest to Oldest
          - img [ref=e23]
      - generic [ref=e25]:
        - img [ref=e27]
        - heading "No projects yet" [level=3] [ref=e30]
        - paragraph [ref=e31]: Start creating your first video project. Import media, edit, and export professional videos.
        - button "Create Your First Project" [ref=e32] [cursor=pointer]:
          - img
          - text: Create Your First Project
  - region "Notifications alt+T"
```