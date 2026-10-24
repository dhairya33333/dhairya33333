// Editable later from Admin → Site content. Placeholders only: replace with Yogesh's own words.
export const SITE_DEFAULTS = {
  site_title: 'Yogesh Singh — Filmmaker · Speaker · Former IPS',
  meta_description: 'Official portfolio of Yogesh Singh: former IPS officer, film director and motivational speaker.',
  hero_name: 'Yogesh Singh',
  hero_roles: 'Former IPS Officer, Film Director, Motivational Speaker',
  hero_tagline: 'From the discipline of public service to the language of cinema, telling stories that move people to act.',
  about_title: 'Service shaped the man. Stories carry the message.',
  about_body: 'Add Yogesh Singh\'s biography here from Admin → Site content.\n\nA few honest paragraphs about the years in the Indian Police Service, the decision to pick up the camera, and why he now speaks to audiences about courage, discipline and purpose.',
  stats: '20+|Years in public service\n1|Feature film directed\n100+|Talks & keynotes\n50K+|Lives touched',
  quote: 'Discipline is the bridge between a dream and a deed.',
  contact_email: 'contact@example.com',
  social_instagram: '', social_youtube: '', social_x: '', social_facebook: '', social_linkedin: '',
  speaking_title: 'Invite him to speak',
  speaking_body: 'Leadership, resilience, civic duty and the creative life. Keynotes for universities, institutions and organisations.',
};

// Keys the admin can edit through the content form (secrets are handled separately).
export const EDITABLE_KEYS = Object.keys(SITE_DEFAULTS);
export const SECRET_KEYS = ['ig_token'];
