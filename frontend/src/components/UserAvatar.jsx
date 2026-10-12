import { mediaUrl } from '../utils/mediaUrl.js';

export default function UserAvatar({
  user,
  name,
  avatarUrl,
  className = '',
  size = 'md',
}) {
  const displayName = name || user?.name || '';
  const url = mediaUrl(avatarUrl || user?.avatarUrl);
  const letter = displayName?.[0] || 'ز';
  const classes = ['user-avatar', size !== 'md' ? size : '', className]
    .filter(Boolean)
    .join(' ');

  if (url) {
    return (
      <div className={classes} title={displayName}>
        <img src={url} alt={displayName || ''} />
      </div>
    );
  }

  return (
    <div className={classes} title={displayName}>
      <span>{letter}</span>
    </div>
  );
}
