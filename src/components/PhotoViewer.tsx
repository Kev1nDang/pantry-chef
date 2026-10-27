import { useState } from 'react';
import { messageOf } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { SavedPhoto } from '../lib/usePhotos';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface Props {
  photo: SavedPhoto;
  /** read the photo's groceries again */
  onRead: (photo: SavedPhoto) => void;
  onDelete: (photo: SavedPhoto) => Promise<void>;
  onClose: () => void;
}

export function PhotoViewer({ photo, onRead, onDelete, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(photo);
      onClose();
    } catch (err) {
      setError(messageOf(err));
      setDeleting(false);
    }
  }

  return (
    <Modal labelledBy="photo-title" onClose={onClose}>
      <header>
        <h2 id="photo-title">Saved photo</h2>
        <p className="recipe-meta">{formatDateTime(photo.createdAt)}</p>
      </header>
      <figure className="photo-preview photo-full">
        <img src={photo.url} alt={`Pantry photo from ${formatDateTime(photo.createdAt)}`} />
      </figure>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn btn-ghost btn-danger" disabled={deleting} onClick={remove}>
          <Icon name="trash" size={16} /> {deleting ? 'Deleting…' : 'Delete'}
        </button>
        <button className="btn btn-primary" disabled={deleting} onClick={() => onRead(photo)}>
          <Icon name="sparkles" size={16} /> Read groceries
        </button>
      </div>
    </Modal>
  );
}
