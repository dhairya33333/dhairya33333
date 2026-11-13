// Starting text for the extra pages (Story, Law, Books & Film, Speaking & Media, Family). Written from the client's "Website Inputs"
// document. Editable in Admin → Pages. Tiny markup: "## heading", "- list item", "> quote", "**bold**", "[text](https://… or /page)".
export const PAGE_META = {
  story: { path: '/story', eyebrow: 'Story', title: 'More about Y.P. Singh', lede: 'Mumbai-based. Studied at Elphinstone College. IPS, 1985, Maharashtra cadre.' },
  law: { path: '/law', eyebrow: 'Law practice', title: 'The law, after the uniform', lede: 'Investigative skills, applied to the law.' },
  books: { path: '/books', eyebrow: 'Books & film', title: 'Books and film', lede: 'Novels and films drawn from the inside of public institutions.' },
  speaking: { path: '/speaking', eyebrow: 'Speaking & media', title: 'Speaking and media', lede: 'A powerful speaker in English and in Hindi.' },
  family: { path: '/family', eyebrow: 'Family', title: 'Family and lineage', lede: 'A family of public servants, scholars and musicians.' },
};

export const PAGE_DEFAULTS = {
  story: `I joined the service believing the uniform was a public trust. District postings in Wardha, Akola and Solapur taught me what policing looks like on the ground. FDA vigilance and the CBI taught me how large frauds are structured. Command of SRPF Group 8 in Goregaon taught me leadership of an armed reserve.

What I could not accept was a culture in which honest inquiry is punished and silence is rewarded. I completed a law degree, received the Gold Medal from the University of Mumbai in 2001, and left the IPS in 2004. The work did not stop. It changed tools.

> “The rot in the police machinery had suffocated me… my crusade against corruption will continue.”
> On resignation, 2004

## Where the work led
- [The law practice](/law): investigation, now used for remedies.
- [Books and film](/books): fiction drawn from experience.
- [Speaking and media](/speaking): integrity, in English and Hindi.`,

  law: `As a lawyer, I use my intense investigative skills with the profound concepts of law in diverse spheres. That is how I developed a unique approach to tackling complex legal issues.

## Main practice areas
- Land, town-planning, infrastructure and environmental issues.
- Governance, service, IPR and administrative law.
- White-collar and economic-offence related advisory, where briefed.
- Sometimes, complicated criminal matters that have a bearing on civil issues.

## The method
Police training for investigation. Law knowledge for remedies.

University of Mumbai gold-standard finish in 2001, before leaving the service.

## Office
1001, Raheja Centre, Free Press Journal Road, Nariman Point, Mumbai 400021.

[Get in touch →](/contact?topic=general)`,

  books: `## Books
- **Carnage by Angels.** A novel of an honest officer inside a compromised force. Later adapted into a film.
- **Vultures in Love.** A second novel that traverses the deep underworld of corruption, against the backdrop of the CBI and the Revenue Services.

## Film
- **Kya Yahi Sach Hai (2010).** Written and directed by him. A fictional account of police corruption drawn from experience, and the winner of international recognition, including at the California Film Awards. [Watch it here →](/films)
- **Indian Supari Company (under making).** A highly intellectual film with an unprecedented storyline and a simple theme: there is no need to give a supari to a criminal. Give it to a public servant, and he will use his statutory powers to deliver the result.
- **A series based on Vultures in Love.** Aimed at being unprecedented in topical content.`,

  speaking: `A very powerful English and Hindi language speaker. Listen on Instagram: [@lifetainmentenglish](https://www.instagram.com/lifetainmentenglish/) and [@lifetainmenthindi](https://www.instagram.com/lifetainmenthindi/).

## Talks
- Integrity and institutional design
- Whistleblowing and the cost of dissent
- Economic crime and investigation culture
- From khaki to black gown: a second public life

## Press shelf
Photographs of earlier press articles will be added here.

> I left the service. I did not leave the question: can a public institution be both powerful and clean?

[Invite him to speak →](/contact?topic=speaking)`,

  family: `**Father.** Dr. Samar Bahadur Singh, eminent historian and musician. He worked as a lecturer at the National Defence Academy and later retired as Deputy Director General in charge of the Western Region of All India Radio.

He was felicitated by the Hon'ble Prime Minister in 2015 (posthumously) for his work in creating a musical recording of Ram Charit Manas, which is played every morning by all the Hindi language stations of All India Radio.

**Spouse.** Abha Singh, former bureaucrat and now an advocate, known all over the country for her advocacy of women's and children's rights. She is also an environmental lawyer, seeking to preserve our precious environment.

**Daughter.** Isha Singh passed out from the National Law School, Bangalore, and later joined the IPS (2021 batch). She did a stint in Pondicherry and is now posted with Delhi Police.

> The public story often told: a daughter who said she wanted the chair from which her father was pushed.`,
};
