// Editable later from Admin → Site content. Placeholders only: replace with Yogesh's own words.
export const SITE_DEFAULTS = {
  site_title: 'Y.P. Singh: Former IPS Officer, Lawyer, Author & Filmmaker',
  meta_description: 'Y.P. Singh (Yogesh Pratap Singh): 1985-batch IPS officer turned Mumbai lawyer, author of Carnage by Angels and Vultures in Love, director of Kya Yahi Sach Hai, and a motivational speaker in English and Hindi.',
  hero_name: 'Y.P. Singh',
  full_name: 'Yogesh Pratap Singh',   // used by Google (structured data) and the biography; hero_name is the short display name
  hero_roles: 'Former IPS Officer, Lawyer, Author, Filmmaker',
  hero_tagline: 'Twenty years in uniform. Then the law, the page, and the camera: same fight, integrity in public life.',
  about_title: 'Same fight: integrity in public life.',
  about_body: 'Yogesh Pratap Singh is a 1985-batch officer of the Indian Police Service (Maharashtra cadre). After district policing, FDA vigilance, CBI work, and command of a State Reserve Police Force group, he left service mid-way in 2004 and built a second career as a Mumbai lawyer and public-interest campaigner. He is the author of Carnage by Angels and Vultures in Love, and director of the internationally awarded film Kya Yahi Sach Hai (2010).',
  stats: '1985|IPS batch, Maharashtra cadre\n2001|Gold Medal, University of Mumbai (law)\n2004|Left the IPS\n2010|Kya Yahi Sach Hai',
  pillars: 'The officer|Akola, Wardha, State Police Headquarters, Mumbai, FDA, CBI and the SRPF.|/story\nThe lawyer|Mainly land, environment, criminal, corporate and governance cases.|/law\nThe storyteller|Novels, film and talks.|/books\nThe motivational speaker|Hear him on Instagram, in English and in Hindi.|instagram',
  quote: '“The rot in the police machinery had suffocated me… my crusade against corruption will continue.” On resignation, 2004.',
  portrait: '',
  gallery_title: 'Gallery',
  gallery_intro: 'Moments from the sets, the stage and the road.',
  contact_email: 'ypsinghfilms@gmail.com',
  contact_phone: '',
  contact_whatsapp: '+91 98210 08221',
  contact_location: '1001, Raheja Centre, Free Press Journal Road, Nariman Point, Mumbai 400021',
  contact_intro: 'For speaking, film and media enquiries, write to ypsinghfilms@gmail.com, message on WhatsApp, or use the form below.',
  social_title: 'On social media',
  social_intro: 'Motivation in English and in Hindi, on Instagram.',
  social_instagram: '', social_instagram_en: 'https://www.instagram.com/lifetainmentenglish/', social_instagram_hi: 'https://www.instagram.com/lifetainmenthindi/',
  social_youtube: '', social_x: '', social_facebook: '', social_linkedin: '',
  speaking_title: 'Invite him to speak',
  speaking_body: 'Integrity and institutional design, whistleblowing and the cost of dissent, economic crime and investigation culture. In English and in Hindi.',
};

// Hindi versions of the editable site text. Empty means "show the English text". Written by the site owner in Admin → Site content.
export const HI_KEYS = ['hero_name', 'hero_roles', 'hero_tagline', 'about_title', 'about_body', 'stats', 'quote', 'contact_intro', 'social_title', 'social_intro', 'gallery_title', 'gallery_intro', 'speaking_title', 'speaking_body'];
// Starting Hindi text for the placeholder English content above. AI-written: have a native speaker check it, and edit it in Admin → Site content.
const HI_START = {
  hero_name: 'वाई.पी. सिंह',
  hero_roles: 'पूर्व आईपीएस अधिकारी, वकील, लेखक, फ़िल्मकार',
  hero_tagline: 'वर्दी में बीस साल। फिर क़ानून, किताब और कैमरा: लड़ाई वही, सार्वजनिक जीवन में ईमानदारी।',
  about_title: 'लड़ाई वही: सार्वजनिक जीवन में ईमानदारी।',
  about_body: 'योगेश प्रताप सिंह भारतीय पुलिस सेवा (महाराष्ट्र कैडर) के 1985 बैच के अधिकारी हैं। ज़िला पुलिसिंग, एफ़डीए सतर्कता, सीबीआई के काम और राज्य रिज़र्व पुलिस बल के एक समूह की कमान के बाद उन्होंने 2004 में सेवा बीच में छोड़ दी और मुंबई में वकील तथा जनहित अभियानकर्ता के रूप में दूसरा करियर बनाया। वे “कार्नेज बाय एंजल्स” और “वल्चर्स इन लव” के लेखक हैं और अंतरराष्ट्रीय स्तर पर पुरस्कृत फ़िल्म “क्या यही सच है” (2010) के निर्देशक हैं।',
  stats: '1985|आईपीएस बैच, महाराष्ट्र कैडर\n2001|मुंबई विश्वविद्यालय का स्वर्ण पदक (क़ानून)\n2004|आईपीएस छोड़ा\n2010|क्या यही सच है',
  contact_intro: 'वक्तव्य, फ़िल्म और मीडिया संबंधी पूछताछ के लिए ypsinghfilms@gmail.com पर लिखें, WhatsApp करें, या नीचे दिया फ़ॉर्म भरें।',
  social_title: 'सोशल मीडिया पर',
  social_intro: 'इंस्टाग्राम पर अंग्रेज़ी और हिंदी में प्रेरक सामग्री।',
  gallery_title: 'गैलरी',
  gallery_intro: 'सेट, मंच और सफ़र के कुछ पल।',
  speaking_title: 'उन्हें बोलने के लिए बुलाएँ',
  speaking_body: 'ईमानदारी और संस्थागत ढाँचा, व्हिसलब्लोइंग और असहमति की क़ीमत, आर्थिक अपराध और जाँच-संस्कृति। अंग्रेज़ी और हिंदी में।',
};
for (const k of HI_KEYS) SITE_DEFAULTS[`${k}_hi`] = HI_START[k] ?? '';

// Timeline entries created on first start (editable in Admin → Journey).
export const WORKS_SEED = [
  ['career', 'Indian Police Service', 'Maharashtra cadre, 1985 batch. District postings in Wardha, Akola and Solapur; FDA vigilance; the CBI; command of SRPF Group 8, Goregaon.', '1985–2004', 1],
  ['career', 'Law degree and Gold Medal', 'University of Mumbai, while still in service.', '2001', 2],
  ['career', 'Left the IPS, became a lawyer', 'Left service mid-way and built a second career as a Mumbai lawyer and public-interest campaigner.', '2004', 3],
  ['book', 'Carnage by Angels', 'A novel of an honest officer inside a compromised force. Later adapted.', '', 4],
  ['book', 'Vultures in Love', 'A second novel through the underworld of corruption, against the backdrop of the CBI and the Revenue Services.', '', 5],
  ['film', 'Kya Yahi Sach Hai', 'Written and directed by him. Fiction about police corruption, drawn from experience. Internationally awarded.', '2010', 6],
  ['film', 'Indian Supari Company', 'Under making: give it to a public servant, and he will use his statutory powers to deliver the result.', 'In the making', 7],
  ['talk', 'Motivational speaking', 'In English and in Hindi, on Instagram and on stage.', 'Ongoing', 8],
];

// Keys the admin can edit through the content form (secrets are handled separately).
export const LEGAL_KEYS = ['legal_privacy', 'legal_terms', 'legal_refunds'];
export const EDITABLE_KEYS = Object.keys(SITE_DEFAULTS);
export const SECRET_KEYS = ['ig_token'];
