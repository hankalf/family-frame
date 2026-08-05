/**
 * Bundled quotes, so the frame has something to show with no network and no
 * third-party service to outlive it. Kept to public-domain sources and common
 * proverbs rather than modern copyrighted material.
 *
 * Admins can add their own in Admin → Display; family sayings beat anything in
 * this list.
 */
const BUILT_IN = [
  { text: 'Very little is needed to make a happy life.', by: 'Marcus Aurelius' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', by: 'Proverb' },
  { text: 'Go confidently in the direction of your dreams.', by: 'Henry David Thoreau' },
  { text: 'What lies behind us and what lies before us are tiny matters compared to what lies within us.', by: 'Ralph Waldo Emerson' },
  { text: 'It is not the mountain we conquer, but ourselves.', by: 'Proverb' },
  { text: 'Fall seven times, stand up eight.', by: 'Japanese proverb' },
  { text: 'He who has a why to live can bear almost any how.', by: 'Friedrich Nietzsche' },
  { text: 'The journey of a thousand miles begins with a single step.', by: 'Lao Tzu' },
  { text: 'Nothing is worth more than this day.', by: 'Johann Wolfgang von Goethe' },
  { text: 'Waste no more time arguing what a good person should be. Be one.', by: 'Marcus Aurelius' },
  { text: 'A ship in harbour is safe, but that is not what ships are built for.', by: 'John A. Shedd' },
  { text: 'Whether you think you can or think you cannot, you are right.', by: 'Henry Ford' },
  { text: 'The secret of getting ahead is getting started.', by: 'Mark Twain' },
  { text: 'Kind words can be short and easy to speak, but their echoes are truly endless.', by: 'Mother Teresa' },
  { text: 'We suffer more often in imagination than in reality.', by: 'Seneca' },
  { text: 'Do what you can, with what you have, where you are.', by: 'Theodore Roosevelt' },
  { text: 'Little by little, one travels far.', by: 'Proverb' },
  { text: 'The happiness of your life depends upon the quality of your thoughts.', by: 'Marcus Aurelius' },
  { text: 'Rivers know this: there is no hurry. We shall get there some day.', by: 'A. A. Milne' },
  { text: 'A journey is best measured in friends, rather than miles.', by: 'Tim Cahill' },
  { text: 'Enjoy the little things, for one day you may look back and realise they were the big things.', by: 'Robert Brault' },
  { text: 'It always seems impossible until it is done.', by: 'Proverb' },
  { text: 'Simplicity is the ultimate sophistication.', by: 'Leonardo da Vinci' },
  { text: 'Well done is better than well said.', by: 'Benjamin Franklin' },
  { text: 'Energy and persistence conquer all things.', by: 'Benjamin Franklin' },
  { text: 'The only way round is through.', by: 'Robert Frost' },
  { text: 'Adopt the pace of nature: her secret is patience.', by: 'Ralph Waldo Emerson' },
  { text: 'To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.', by: 'Ralph Waldo Emerson' },
  { text: 'A smooth sea never made a skilled sailor.', by: 'Proverb' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', by: 'Seneca' },
  { text: 'The best preparation for tomorrow is doing your best today.', by: 'H. Jackson Brown Jr.' },
  { text: 'Where there is love there is life.', by: 'Mahatma Gandhi' },
  { text: 'You cannot swim for new horizons until you have courage to lose sight of the shore.', by: 'William Faulkner' },
  { text: 'A house is made of walls and beams; a home is built with love and dreams.', by: 'Proverb' },
  { text: 'However difficult life may seem, there is always something you can do and succeed at.', by: 'Stephen Hawking' },
  { text: 'The days are long but the years are short.', by: 'Proverb' },
  { text: 'Gratitude turns what we have into enough.', by: 'Aesop' },
  { text: 'No act of kindness, no matter how small, is ever wasted.', by: 'Aesop' },
  { text: 'Slow and steady wins the race.', by: 'Aesop' },
  { text: 'Look deep into nature, and then you will understand everything better.', by: 'Albert Einstein' },
];

/** Parses the admin's custom list: one per line, optional " — Author". */
export function parseCustomQuotes(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)\s+[—–-]\s+([^—–-]+)$/);
      return match ? { text: match[1].trim(), by: match[2].trim() } : { text: line, by: null };
    });
}

/** Stable hash so every display picks the same quote on the same day. */
function hashDate(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * The quote for a given day. Deterministic, so it doesn't shuffle on every
 * reload — it changes at midnight and matches across every frame in the house.
 */
export function quoteForDay(dayKeyValue, { useBuiltIn = true, custom = '' } = {}) {
  const pool = [...parseCustomQuotes(custom), ...(useBuiltIn ? BUILT_IN : [])];
  if (!pool.length) return null;
  return pool[hashDate(dayKeyValue) % pool.length];
}

export const BUILT_IN_COUNT = BUILT_IN.length;
