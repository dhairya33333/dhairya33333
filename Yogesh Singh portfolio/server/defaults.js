// Editable later from Admin → Site content. Placeholders only: replace with Yogesh's own words.
export const SITE_DEFAULTS = {
  site_title: 'Yogesh Pratap Singh — Former IPS Officer, Author & Film Director',
  meta_description: 'Official site of Yogesh Pratap Singh (Y. P. Singh): former IPS officer, author of Carnage by Angels, director of Kya Yahi Sach Hai and motivational speaker.',
  hero_name: 'Yogesh Pratap Singh',
  hero_roles: 'Former IPS Officer, Author, Film Director, Motivational Speaker',
  hero_tagline: 'From the Indian Police Service to the written word and the silver screen: telling hard truths about justice, integrity and courage.',
  about_title: 'A career in service. A voice for the truth.',
  about_body: 'Yogesh Pratap Singh, widely known as Y. P. Singh, is an Indian Police Service officer of the 1985 batch, Maharashtra cadre. After leaving the service he built a second career as a lawyer and activist in Mumbai.\n\nHis 2003 novel, Carnage by Angels, drew on his years inside the system to expose corruption and malpractice in the police force.\n\nHe then turned the book into cinema. As director of Kya Yahi Sach Hai, he won the Silver Award in the Narrative Film category at the California Film Awards (2010), and the film reached Indian cinemas in December 2011.\n\nToday he shares these experiences from the stage as a motivational speaker, on courage, integrity and standing up for what is right.',
  stats: '1985|IPS batch, Maharashtra cadre\n2003|Novel “Carnage by Angels”\n2010|Silver Award, California Film Awards\n2011|Cinema release of Kya Yahi Sach Hai',
  quote: '',
  portrait: '',
  gallery_title: 'Gallery',
  gallery_intro: 'Moments from the sets, the stage and the road.',
  contact_email: '',
  contact_phone: '',
  contact_location: '',
  contact_intro: 'For speaking invitations, film enquiries, press and collaborations, send a message and it will reach Yogesh Singh directly.',
  social_title: 'On social media',
  social_intro: 'Recent posts and reels from Instagram.',
  social_instagram: '', social_youtube: '', social_x: '', social_facebook: '', social_linkedin: '',
  speaking_title: 'Invite him to speak',
  speaking_body: 'Integrity, courage, justice and the creative life. Talks for universities, institutions and organisations.',
};

// Timeline entries created on first start (editable in Admin → Journey).
export const WORKS_SEED = [
  ['career', 'Indian Police Service', 'Officer of the 1985 batch, Maharashtra cadre.', '1985 onwards', 1],
  ['career', 'Lawyer & activist, Mumbai', 'After leaving the service, practised law and campaigned on public causes.', 'After IPS', 2],
  ['book', 'Carnage by Angels', 'A novel exposing corruption and malpractice in the police force.', '2003', 3],
  ['film', 'Kya Yahi Sach Hai', 'Director. Silver Award, Narrative Film category, California Film Awards. Released in Indian cinemas in December 2011.', '2010–2011', 4],
  ['talk', 'Motivational speaking', 'Talks on courage, integrity and standing up for what is right.', 'Ongoing', 5],
];

// Keys the admin can edit through the content form (secrets are handled separately).
export const LEGAL_KEYS = ['legal_privacy', 'legal_terms', 'legal_refunds'];
export const EDITABLE_KEYS = Object.keys(SITE_DEFAULTS);
export const SECRET_KEYS = ['ig_token'];
