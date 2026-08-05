import { useCallback, useEffect, useRef, useState } from 'react';
import { api, photoUrl } from '../api.js';
import { formatShortDate } from '../lib/dates.js';

export default function FeedPage() {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sentinelRef = useRef(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const query = cursor ? `?before=${encodeURIComponent(cursor)}` : '';
      const data = await api.get(`/photos/feed${query}`);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...data.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [cursor]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll.
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: '600px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const toggleLike = async (post) => {
    // Optimistic flip; reconcile with the server's count.
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, liked: !p.liked, likeCount: p.likeCount + (p.liked ? -1 : 1) }
          : p
      )
    );
    try {
      const result = await api.post(`/photos/${post.id}/like`);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, liked: result.liked, likeCount: result.likeCount } : p
        )
      );
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, liked: post.liked, likeCount: post.likeCount }
            : p
        )
      );
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {error && <p className="text-sm text-rose-400">{error}</p>}

      {posts.length === 0 && !loading && (
        <div className="card text-center text-slate-400">
          <p>Nothing in the feed yet.</p>
          <p className="mt-1 text-sm text-slate-600">Photos everyone adds will show up here.</p>
        </div>
      )}

      {posts.map((post) => (
        <article
          key={post.id}
          className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40"
        >
          <header className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-800 text-sm font-semibold uppercase text-slate-300">
              {(post.uploadedByName || '?').slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {post.uploadedByName || 'Folder import'}
              </p>
              <p className="text-xs text-slate-500">{formatShortDate(post.createdAt)}</p>
            </div>
          </header>

          <button
            className="block w-full bg-black"
            onDoubleClick={() => !post.liked && toggleLike(post)}
            aria-label={post.caption || 'Photo'}
          >
            <img
              src={photoUrl(post.id, 'display')}
              alt={post.caption || ''}
              loading="lazy"
              className="max-h-[70vh] w-full object-contain"
              style={
                post.width && post.height
                  ? { aspectRatio: `${post.width} / ${post.height}` }
                  : undefined
              }
            />
          </button>

          <div className="space-y-1.5 px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggleLike(post)}
                aria-pressed={post.liked}
                aria-label={post.liked ? 'Unlike' : 'Like'}
                className={[
                  'text-2xl transition active:scale-125',
                  post.liked ? 'text-rose-500' : 'text-slate-400 hover:text-slate-200',
                ].join(' ')}
              >
                {post.liked ? '♥' : '♡'}
              </button>
              {post.likeCount > 0 && (
                <span className="text-sm font-medium text-slate-300">
                  {post.likeCount} {post.likeCount === 1 ? 'like' : 'likes'}
                </span>
              )}
            </div>
            {post.caption && (
              <p className="text-sm text-slate-200">
                <span className="mr-1.5 font-medium">{post.uploadedByName}</span>
                {post.caption}
              </p>
            )}
          </div>
        </article>
      ))}

      {hasMore && (
        <div ref={sentinelRef} className="py-6 text-center text-sm text-slate-600">
          {loading ? 'Loading…' : ''}
        </div>
      )}
    </div>
  );
}
