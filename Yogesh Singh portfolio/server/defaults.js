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

// Hindi versions of the editable site text. Empty means "show the English text". Written by the site owner in Admin → Site content.
export const HI_KEYS = ['hero_name', 'hero_roles', 'hero_tagline', 'about_title', 'about_body', 'stats', 'quote', 'contact_intro', 'social_title', 'social_intro', 'gallery_title', 'gallery_intro', 'speaking_title', 'speaking_body'];
// Starting Hindi text for the placeholder English content above. AI-written: have a native speaker check it, and edit it in Admin → Site content.
const HI_START = {
  hero_name: 'योगेश प्रताप सिंह',
  hero_roles: 'पूर्व आईपीएस अधिकारी, लेखक, फ़िल्म निर्देशक, प्रेरक वक्ता',
  hero_tagline: 'भारतीय पुलिस सेवा से लेखन और रुपहले परदे तक: न्याय, ईमानदारी और साहस के बारे में कड़वे सच कहने का सफ़र।',
  about_title: 'सेवा का करियर। सच की आवाज़।',
  about_body: 'योगेश प्रताप सिंह, जिन्हें वाई. पी. सिंह के नाम से जाना जाता है, 1985 बैच के भारतीय पुलिस सेवा अधिकारी हैं (महाराष्ट्र कैडर)। सेवा छोड़ने के बाद उन्होंने मुंबई में वकील और कार्यकर्ता के रूप में दूसरा करियर बनाया।\n\nउनका 2003 का उपन्यास “कार्नेज बाय एंजल्स” व्यवस्था के भीतर बिताए उनके वर्षों पर आधारित है और पुलिस बल में भ्रष्टाचार और कदाचार को उजागर करता है।\n\nफिर उन्होंने इस पुस्तक को सिनेमा में बदला। “क्या यही सच है” के निर्देशक के रूप में उन्हें कैलिफ़ोर्निया फ़िल्म अवॉर्ड्स (2010) में नैरेटिव फ़िल्म श्रेणी का सिल्वर अवॉर्ड मिला, और फ़िल्म दिसंबर 2011 में भारतीय सिनेमाघरों में पहुँची।\n\nआज वे प्रेरक वक्ता के रूप में मंच से अपने अनुभव साझा करते हैं: साहस, ईमानदारी और सही के लिए खड़े होने के बारे में।',
  stats: '1985|आईपीएस बैच, महाराष्ट्र कैडर\n2003|उपन्यास “कार्नेज बाय एंजल्स”\n2010|सिल्वर अवॉर्ड, कैलिफ़ोर्निया फ़िल्म अवॉर्ड्स\n2011|क्या यही सच है का सिनेमा में प्रदर्शन',
  contact_intro: 'वक्ता के रूप में आमंत्रण, फ़िल्म संबंधी पूछताछ, प्रेस और सहयोग के लिए संदेश भेजें। वह सीधे योगेश सिंह तक पहुँचेगा।',
  social_title: 'सोशल मीडिया पर',
  social_intro: 'इंस्टाग्राम की हाल की पोस्ट और रील।',
  gallery_title: 'गैलरी',
  gallery_intro: 'सेट, मंच और सफ़र के कुछ पल।',
  speaking_title: 'उन्हें बोलने के लिए बुलाएँ',
  speaking_body: 'ईमानदारी, साहस, न्याय और रचनात्मक जीवन। विश्वविद्यालयों, संस्थानों और संगठनों के लिए व्याख्यान।',
};
for (const k of HI_KEYS) SITE_DEFAULTS[`${k}_hi`] = HI_START[k] ?? '';

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
