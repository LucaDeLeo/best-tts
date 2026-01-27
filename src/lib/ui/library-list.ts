/**
 * Shared Library List Component
 * Per CONTEXT.md Decision #9: Shared components for popup and side panel
 * Uses safe DOM methods (createElement/appendChild) - no innerHTML
 */

import type { LibraryItem } from '../library-types';

export interface FolderData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryListCallbacks {
  onItemClick: (itemId: string) => void;
  onItemDelete: (itemId: string) => void;
  onItemMove: (itemId: string, folderId: string | null) => void;
}

export interface FolderListCallbacks {
  onFolderSelect: (folderId: string | null) => void;
  onFolderRename: (folderId: string, currentName: string) => void;
  onFolderDelete: (folderId: string) => void;
}

/**
 * Render library items list
 * @param container - Container element to render into (will be cleared)
 * @param items - Library items to display
 * @param selectedId - Currently selected item ID (optional)
 * @param callbacks - Event callbacks
 */
export function renderLibraryList(
  container: HTMLElement,
  items: LibraryItem[],
  selectedId: string | null,
  callbacks: LibraryListCallbacks
): void {
  // Clear container safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No items in library';
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const itemEl = document.createElement('div');
    itemEl.className = 'list-item library-item';
    if (item.contentDeleted) {
      itemEl.classList.add('content-deleted');
    }
    if (item.id === selectedId) {
      itemEl.classList.add('selected');
    }
    itemEl.dataset.itemId = item.id;

    // Icon
    const icon = document.createElement('span');
    icon.className = 'item-icon';
    icon.textContent = getSourceIcon(item.source);
    itemEl.appendChild(icon);

    // Content
    const content = document.createElement('div');
    content.className = 'list-item-content';

    const title = document.createElement('div');
    title.className = 'list-item-title';
    title.textContent = item.title || 'Untitled';
    title.title = item.title || 'Untitled';
    content.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'list-item-meta';
    const date = new Date(item.lastReadAt);
    const sizeKB = Math.round(item.contentSize / 1024);
    meta.textContent = `${date.toLocaleDateString()} | ${sizeKB} KB`;
    content.appendChild(meta);

    itemEl.appendChild(content);

    // Progress indicator if has resume data
    if (item.resumeData?.charOffset && item.resumeData?.contentLength) {
      const progress = Math.round(
        (item.resumeData.charOffset / item.resumeData.contentLength) * 100
      );
      const progressEl = document.createElement('span');
      progressEl.className = 'progress-badge';
      progressEl.textContent = `${progress}%`;
      itemEl.appendChild(progressEl);
    }

    // Content deleted badge
    if (item.contentDeleted) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-warning';
      badge.textContent = 'Deleted';
      itemEl.appendChild(badge);
    }

    // Click handler
    itemEl.addEventListener('click', () => callbacks.onItemClick(item.id));

    container.appendChild(itemEl);
  }
}

/**
 * Render folder list with "All Items" root
 * @param container - Container element to render into (will be cleared)
 * @param folders - Folders to display
 * @param selectedFolderId - Currently selected folder ID (null = All Items)
 * @param callbacks - Event callbacks
 */
export function renderFolderList(
  container: HTMLElement,
  folders: FolderData[],
  selectedFolderId: string | null,
  callbacks: FolderListCallbacks
): void {
  // Clear container safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Add "All Items" root folder
  const allItemsEl = createFolderElement(
    { id: '__root__', name: 'All Items', createdAt: 0, updatedAt: 0 },
    selectedFolderId === null,
    () => callbacks.onFolderSelect(null),
    null, // No rename for root
    null  // No delete for root
  );
  container.appendChild(allItemsEl);

  // Add user folders
  for (const folder of folders) {
    const folderEl = createFolderElement(
      folder,
      folder.id === selectedFolderId,
      () => callbacks.onFolderSelect(folder.id),
      () => callbacks.onFolderRename(folder.id, folder.name),
      () => callbacks.onFolderDelete(folder.id)
    );
    container.appendChild(folderEl);
  }
}

/**
 * Create a folder list element
 */
function createFolderElement(
  folder: FolderData,
  isSelected: boolean,
  onSelect: () => void,
  onRename: (() => void) | null,
  onDelete: (() => void) | null
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'folder-item';
  if (isSelected) {
    el.classList.add('active');
  }

  // Icon
  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.textContent = folder.id === '__root__' ? '\u{1F4DA}' : '\u{1F4C1}'; // Books or folder
  el.appendChild(icon);

  // Name
  const name = document.createElement('span');
  name.className = 'folder-name';
  name.textContent = folder.name;
  el.appendChild(name);

  // Actions (for non-root folders)
  if (onRename || onDelete) {
    const actions = document.createElement('div');
    actions.className = 'folder-actions-inline';

    if (onRename) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'folder-action-btn';
      renameBtn.textContent = '\u{270F}'; // Pencil
      renameBtn.title = 'Rename';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRename();
      });
      actions.appendChild(renameBtn);
    }

    if (onDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'folder-action-btn';
      deleteBtn.textContent = '\u{2716}'; // X
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete();
      });
      actions.appendChild(deleteBtn);
    }

    el.appendChild(actions);
  }

  el.addEventListener('click', onSelect);

  return el;
}

/**
 * Get icon for library item source type
 */
function getSourceIcon(source: string): string {
  switch (source) {
    case 'pdf':
      return '\u{1F4C4}'; // Page
    case 'text':
      return '\u{1F4DD}'; // Memo
    default:
      return '\u{1F310}'; // Globe
  }
}

/**
 * Create folder select dropdown for moving items
 * @param folders - Available folders
 * @param currentFolderId - Item's current folder ID
 * @param onChange - Callback when selection changes
 */
export function createFolderSelect(
  folders: FolderData[],
  currentFolderId: string | null,
  onChange: (folderId: string | null) => void
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'folder-select';

  // Root option
  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = 'Root (no folder)';
  if (currentFolderId === null) {
    rootOption.selected = true;
  }
  select.appendChild(rootOption);

  // Folder options
  for (const folder of folders) {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.name;
    if (folder.id === currentFolderId) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    onChange(select.value || null);
  });

  return select;
}
