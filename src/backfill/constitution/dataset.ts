export type ConstitutionRecordType = 'article' | 'amendment';
export interface ConstitutionProvisionRecord { type: ConstitutionRecordType; number: number; romanNumeral: string; heading: string; proposed: string; ratified: string; proposing_body: string; proposingBody: string; authorName: string; authorEmail: string; source: string; markdownBody: string; }
export interface ConstitutionDataset { constitution: { signed: string; ratified: string; ratifiedDetail: string; source: string; authorName: string; authorEmail: string; articles: ConstitutionProvisionRecord[]; }; amendments: ConstitutionProvisionRecord[]; }

const articleRomanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

export const constitutionDataset: ConstitutionDataset = {
  constitution: {
    signed: '1787-09-17',
    ratified: '1788-06-21',
    ratifiedDetail: '9th state: New Hampshire',
    source: 'https://constitution.congress.gov/constitution/',
    authorName: 'Constitutional Convention',
    authorEmail: 'convention@constitution.gov',
    articles: [
      { type: 'article', number: 1, romanNumeral: articleRomanNumerals[0], heading: 'Legislative Powers', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-1/', markdownBody: `## Article I

### Section 1.
All legislative Powers herein granted shall be vested in a Congress of the United States, which shall consist of a Senate and House of Representatives.

### Section 2.
The House of Representatives shall be composed of Members chosen every second Year by the People of the several States, and the Electors in each State shall have the Qualifications requisite for Electors of the most numerous Branch of the State Legislature.

No Person shall be a Representative who shall not have attained to the Age of twenty five Years, and been seven Years a Citizen of the United States, and who shall not, when elected, be an Inhabitant of that State in which he shall be chosen.

Representatives and direct Taxes shall be apportioned among the several States according to their respective Numbers. The actual Enumeration shall be made within three Years after the first Meeting of the Congress of the United States, and within every subsequent Term of ten Years, in such Manner as they shall by Law direct.

When vacancies happen in the Representation from any State, the Executive Authority thereof shall issue Writs of Election to fill such Vacancies.

The House of Representatives shall chuse their Speaker and other Officers; and shall have the sole Power of Impeachment.

### Section 3.
The Senate of the United States shall be composed of two Senators from each State, for six Years; and each Senator shall have one Vote.

Immediately after they shall be assembled in Consequence of the first Election, they shall be divided as equally as may be into three Classes.

No Person shall be a Senator who shall not have attained to the Age of thirty Years, and been nine Years a Citizen of the United States.

The Vice President of the United States shall be President of the Senate, but shall have no Vote, unless they be equally divided.

The Senate shall chuse their other Officers, and also a President pro tempore, in the Absence of the Vice President.

The Senate shall have the sole Power to try all Impeachments.

### Section 4.
The Times, Places and Manner of holding Elections for Senators and Representatives, shall be prescribed in each State by the Legislature thereof; but the Congress may at any time by Law make or alter such Regulations.

The Congress shall assemble at least once in every Year.

### Section 5.
Each House shall be the Judge of the Elections, Returns and Qualifications of its own Members, and a Majority of each shall constitute a Quorum to do Business.

Each House may determine the Rules of its Proceedings, punish its Members for disorderly Behaviour, and, with the Concurrence of two thirds, expel a Member.

Each House shall keep a Journal of its Proceedings, and from time to time publish the same.

Neither House, during the Session of Congress, shall, without the Consent of the other, adjourn for more than three days.

### Section 6.
The Senators and Representatives shall receive a Compensation for their Services, to be ascertained by Law, and paid out of the Treasury of the United States.

No Senator or Representative shall, during the Time for which he was elected, be appointed to any civil Office under the Authority of the United States, which shall have been created, or the Emoluments whereof shall have been encreased during such time.

### Section 7.
All Bills for raising Revenue shall originate in the House of Representatives; but the Senate may propose or concur with Amendments as on other Bills.

Every Bill which shall have passed the House of Representatives and the Senate, shall, before it become a Law, be presented to the President of the United States.

Every Order, Resolution, or Vote to which the Concurrence of the Senate and House of Representatives may be necessary shall be presented to the President of the United States.

### Section 8.
The Congress shall have Power To lay and collect Taxes, Duties, Imposts and Excises; to borrow Money on the credit of the United States; to regulate Commerce; to establish an uniform Rule of Naturalization; to coin Money; to establish Post Offices and post Roads; to promote the Progress of Science and useful Arts; to constitute Tribunals inferior to the supreme Court; to define and punish Piracies and Felonies committed on the high Seas; to declare War; to raise and support Armies; to provide and maintain a Navy; to make Rules for the Government and Regulation of the land and naval Forces; to provide for calling forth the Militia; and to make all Laws which shall be necessary and proper for carrying into Execution the foregoing Powers.

### Section 9.
The Migration or Importation of such Persons as any of the States now existing shall think proper to admit, shall not be prohibited by the Congress prior to the Year one thousand eight hundred and eight.

The Privilege of the Writ of Habeas Corpus shall not be suspended, unless when in Cases of Rebellion or Invasion the public Safety may require it.

No Bill of Attainder or ex post facto Law shall be passed.

No Tax or Duty shall be laid on Articles exported from any State.

No Money shall be drawn from the Treasury, but in Consequence of Appropriations made by Law.

No Title of Nobility shall be granted by the United States.

### Section 10.
No State shall enter into any Treaty, Alliance, or Confederation; coin Money; emit Bills of Credit; pass any Bill of Attainder, ex post facto Law, or Law impairing the Obligation of Contracts; or grant any Title of Nobility.

No State shall, without the Consent of the Congress, lay any Imposts or Duties on Imports or Exports.

No State shall, without the Consent of Congress, keep Troops, or Ships of War in time of Peace, enter into any Agreement or Compact with another State, or with a foreign Power, or engage in War, unless actually invaded.` },
      { type: 'article', number: 2, romanNumeral: articleRomanNumerals[1], heading: 'Executive Power', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-2/', markdownBody: `## Article II

### Section 1.
The executive Power shall be vested in a President of the United States of America. He shall hold his Office during the Term of four Years, and, together with the Vice President, chosen for the same Term, be elected as follows.

Each State shall appoint, in such Manner as the Legislature thereof may direct, a Number of Electors, equal to the whole Number of Senators and Representatives to which the State may be entitled in the Congress.

The Congress may determine the Time of chusing the Electors, and the Day on which they shall give their Votes.

No Person except a natural born Citizen, or a Citizen of the United States at the time of the Adoption of this Constitution, shall be eligible to the Office of President.

The President shall, at stated Times, receive for his Services, a Compensation.

Before he enter on the Execution of his Office, he shall take the following Oath or Affirmation: “I do solemnly swear (or affirm) that I will faithfully execute the Office of President of the United States, and will to the best of my Ability, preserve, protect and defend the Constitution of the United States.”

### Section 2.
The President shall be Commander in Chief of the Army and Navy of the United States.

He shall have Power, by and with the Advice and Consent of the Senate, to make Treaties and appoint Ambassadors, other public Ministers and Consuls, Judges of the supreme Court, and all other Officers of the United States.

The President shall have Power to fill up all Vacancies that may happen during the Recess of the Senate.

### Section 3.
He shall from time to time give to the Congress Information of the State of the Union, and recommend to their Consideration such Measures as he shall judge necessary and expedient.

He may, on extraordinary Occasions, convene both Houses, or either of them.

He shall receive Ambassadors and other public Ministers; he shall take Care that the Laws be faithfully executed, and shall Commission all the Officers of the United States.

### Section 4.
The President, Vice President and all civil Officers of the United States, shall be removed from Office on Impeachment for, and Conviction of, Treason, Bribery, or other high Crimes and Misdemeanors.` },
      { type: 'article', number: 3, romanNumeral: articleRomanNumerals[2], heading: 'Judicial Power', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-3/', markdownBody: `## Article III

### Section 1.
The judicial Power of the United States shall be vested in one supreme Court, and in such inferior Courts as the Congress may from time to time ordain and establish.

### Section 2.
The judicial Power shall extend to all Cases, in Law and Equity, arising under this Constitution, the Laws of the United States, and Treaties made, or which shall be made, under their Authority; to Controversies to which the United States shall be a Party; to Controversies between two or more States; between a State and Citizens of another State; between Citizens of different States; and between a State, or the Citizens thereof, and foreign States, Citizens or Subjects.

In all Cases affecting Ambassadors, other public Ministers and Consuls, and those in which a State shall be Party, the supreme Court shall have original Jurisdiction.

The Trial of all Crimes, except in Cases of Impeachment, shall be by Jury.

### Section 3.
Treason against the United States shall consist only in levying War against them, or in adhering to their Enemies, giving them Aid and Comfort.

The Congress shall have Power to declare the Punishment of Treason.` },
      { type: 'article', number: 4, romanNumeral: articleRomanNumerals[3], heading: 'States, Citizenship, and Republican Government', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-4/', markdownBody: `## Article IV

### Section 1.
Full Faith and Credit shall be given in each State to the public Acts, Records, and judicial Proceedings of every other State.

### Section 2.
The Citizens of each State shall be entitled to all Privileges and Immunities of Citizens in the several States.

A Person charged in any State with Treason, Felony, or other Crime, who shall flee from Justice, and be found in another State, shall on Demand of the executive Authority of the State from which he fled, be delivered up.

No Person held to Service or Labour in one State, under the Laws thereof, escaping into another, shall be discharged from such Service or Labour, but shall be delivered up on Claim of the Party to whom such Service or Labour may be due.

### Section 3.
New States may be admitted by the Congress into this Union.

The Congress shall have Power to dispose of and make all needful Rules and Regulations respecting the Territory or other Property belonging to the United States.

### Section 4.
The United States shall guarantee to every State in this Union a Republican Form of Government, and shall protect each of them against Invasion and domestic Violence.` },
      { type: 'article', number: 5, romanNumeral: articleRomanNumerals[4], heading: 'Amendment Process', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-5/', markdownBody: `## Article V

The Congress, whenever two thirds of both Houses shall deem it necessary, shall propose Amendments to this Constitution, or, on the Application of the Legislatures of two thirds of the several States, shall call a Convention for proposing Amendments, which, in either Case, shall be valid to all Intents and Purposes, as Part of this Constitution, when ratified by the Legislatures of three fourths of the several States, or by Conventions in three fourths thereof.` },
      { type: 'article', number: 6, romanNumeral: articleRomanNumerals[5], heading: 'Debts, Supremacy, Oaths', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-6/', markdownBody: `## Article VI

All Debts contracted and Engagements entered into, before the Adoption of this Constitution, shall be as valid against the United States under this Constitution, as under the Confederation.

This Constitution, and the Laws of the United States which shall be made in Pursuance thereof, and all Treaties made under the Authority of the United States, shall be the supreme Law of the Land.

The Senators and Representatives before mentioned, and all executive and judicial Officers, both of the United States and of the several States, shall be bound by Oath or Affirmation, to support this Constitution; but no religious Test shall ever be required as a Qualification to any Office or public Trust under the United States.` },
      { type: 'article', number: 7, romanNumeral: articleRomanNumerals[6], heading: 'Ratification', proposed: '1787-09-17', ratified: '1788-06-21', proposing_body: 'Constitutional Convention', proposingBody: 'Constitutional Convention', authorName: 'Constitutional Convention', authorEmail: 'convention@constitution.gov', source: 'https://constitution.congress.gov/browse/article-7/', markdownBody: `## Article VII

The Ratification of the Conventions of nine States, shall be sufficient for the Establishment of this Constitution between the States so ratifying the Same.

Done in Convention by the Unanimous Consent of the States present the Seventeenth Day of September in the Year of our Lord one thousand seven hundred and Eighty seven.` },
    ],
  },
  amendments: [
    { type: 'amendment', number: 1, romanNumeral: 'I', heading: 'Freedom of Religion, Speech, Assembly, and Petition', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-1/', markdownBody: `Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof; or abridging the freedom of speech, or of the press; or the right of the people peaceably to assemble, and to petition the Government for a redress of grievances.` },
    { type: 'amendment', number: 2, romanNumeral: 'II', heading: 'Right to Keep and Bear Arms', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-2/', markdownBody: `A well regulated Militia, being necessary to the security of a free State, the right of the people to keep and bear Arms, shall not be infringed.` },
    { type: 'amendment', number: 3, romanNumeral: 'III', heading: 'Quartering of Soldiers', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-3/', markdownBody: `No Soldier shall, in time of peace be quartered in any house, without the consent of the Owner, nor in time of war, but in a manner to be prescribed by law.` },
    { type: 'amendment', number: 4, romanNumeral: 'IV', heading: 'Search and Seizure', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-4/', markdownBody: `The right of the people to be secure in their persons, houses, papers, and effects, against unreasonable searches and seizures, shall not be violated, and no Warrants shall issue, but upon probable cause, supported by Oath or affirmation, and particularly describing the place to be searched, and the persons or things to be seized.` },
    { type: 'amendment', number: 5, romanNumeral: 'V', heading: 'Rights in Criminal Cases', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-5/', markdownBody: `No person shall be held to answer for a capital, or otherwise infamous crime, unless on a presentment or indictment of a Grand Jury, except in cases arising in the land or naval forces, or in the Militia, when in actual service in time of War or public danger; nor shall any person be subject for the same offence to be twice put in jeopardy of life or limb; nor shall be compelled in any criminal case to be a witness against himself, nor be deprived of life, liberty, or property, without due process of law; nor shall private property be taken for public use, without just compensation.` },
    { type: 'amendment', number: 6, romanNumeral: 'VI', heading: 'Rights to a Speedy Trial, Witnesses, Counsel', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-6/', markdownBody: `In all criminal prosecutions, the accused shall enjoy the right to a speedy and public trial, by an impartial jury of the State and district wherein the crime shall have been committed, which district shall have been previously ascertained by law, and to be informed of the nature and cause of the accusation; to be confronted with the witnesses against him; to have compulsory process for obtaining witnesses in his favor, and to have the Assistance of Counsel for his defence.` },
    { type: 'amendment', number: 7, romanNumeral: 'VII', heading: 'Jury Trial in Civil Cases', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-7/', markdownBody: `In Suits at common law, where the value in controversy shall exceed twenty dollars, the right of trial by jury shall be preserved, and no fact tried by a jury, shall be otherwise re-examined in any Court of the United States, than according to the rules of the common law.` },
    { type: 'amendment', number: 8, romanNumeral: 'VIII', heading: 'Excessive Bail, Fines, Punishments', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-8/', markdownBody: `Excessive bail shall not be required, nor excessive fines imposed, nor cruel and unusual punishments inflicted.` },
    { type: 'amendment', number: 9, romanNumeral: 'IX', heading: 'Rights Retained by the People', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-9/', markdownBody: `The enumeration in the Constitution, of certain rights, shall not be construed to deny or disparage others retained by the people.` },
    { type: 'amendment', number: 10, romanNumeral: 'X', heading: 'Reserved Powers', proposed: '1789-09-25', ratified: '1791-12-15', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-10/', markdownBody: `The powers not delegated to the United States by the Constitution, nor prohibited by it to the States, are reserved to the States respectively, or to the people.` },
    { type: 'amendment', number: 11, romanNumeral: 'XI', heading: 'Suits Against States', proposed: '1794-03-04', ratified: '1795-02-07', proposing_body: '3rd Congress', proposingBody: '3rd Congress', authorName: '3rd Congress', authorEmail: 'congress-3@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-11/', markdownBody: `The Judicial power of the United States shall not be construed to extend to any suit in law or equity, commenced or prosecuted against one of the United States by Citizens of another State, or by Citizens or Subjects of any Foreign State.` },
    { type: 'amendment', number: 12, romanNumeral: 'XII', heading: 'Election of President and Vice-President', proposed: '1803-12-09', ratified: '1804-06-15', proposing_body: '8th Congress', proposingBody: '8th Congress', authorName: '8th Congress', authorEmail: 'congress-8@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-12/', markdownBody: `The Electors shall meet in their respective states and vote by ballot for President and Vice-President, one of whom, at least, shall not be an inhabitant of the same state with themselves; they shall name in their ballots the person voted for as President, and in distinct ballots the person voted for as Vice-President; they shall make distinct lists of all persons voted for as President, and of all persons voted for as Vice-President, and of the number of votes for each, which lists they shall sign and certify, and transmit sealed to the seat of the government of the United States, directed to the President of the Senate; the President of the Senate shall, in the presence of the Senate and House of Representatives, open all the certificates and the votes shall then be counted; the person having the greatest number of votes for President shall be the President, if such number be a majority of the whole number of Electors appointed; and if no person have such majority, then from the persons having the highest numbers not exceeding three on the list of those voted for as President, the House of Representatives shall choose immediately, by ballot, the President. The person having the greatest number of votes as Vice-President shall be the Vice-President, if such number be a majority of the whole number of Electors appointed; and if no person have a majority, then from the two highest numbers on the list, the Senate shall choose the Vice-President.` },
    { type: 'amendment', number: 13, romanNumeral: 'XIII', heading: 'Abolition of Slavery and Involuntary Servitude', proposed: '1865-01-31', ratified: '1865-12-06', proposing_body: '38th Congress', proposingBody: '38th Congress', authorName: '38th Congress', authorEmail: 'congress-38@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-13/', markdownBody: `### Section 1.
Neither slavery nor involuntary servitude, except as a punishment for crime whereof the party shall have been duly convicted, shall exist within the United States, or any place subject to their jurisdiction.

### Section 2.
Congress shall have power to enforce this article by appropriate legislation.` },
    { type: 'amendment', number: 14, romanNumeral: 'XIV', heading: 'Citizenship, equal protection, due process', proposed: '1866-06-13', ratified: '1868-07-09', proposing_body: '39th Congress', proposingBody: '39th Congress', authorName: '39th Congress', authorEmail: 'congress-39@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-14/', markdownBody: `### Section 1.
All persons born or naturalized in the United States, and subject to the jurisdiction thereof, are citizens of the United States and of the State wherein they reside. No State shall make or enforce any law which shall abridge the privileges or immunities of citizens of the United States; nor shall any State deprive any person of life, liberty, or property, without due process of law; nor deny to any person within its jurisdiction the equal protection of the laws.

### Section 2.
Representatives shall be apportioned among the several States according to their respective numbers, counting the whole number of persons in each State, excluding Indians not taxed.

### Section 3.
No person shall be a Senator or Representative in Congress, or elector of President and Vice-President, or hold any office under the United States or any State, who, having previously taken an oath to support the Constitution of the United States, shall have engaged in insurrection or rebellion against the same.

### Section 4.
The validity of the public debt of the United States, authorized by law, shall not be questioned.

### Section 5.
The Congress shall have power to enforce, by appropriate legislation, the provisions of this article.` },
    { type: 'amendment', number: 15, romanNumeral: 'XV', heading: 'Right to Vote Regardless of Race', proposed: '1869-02-26', ratified: '1870-02-03', proposing_body: '40th Congress', proposingBody: '40th Congress', authorName: '40th Congress', authorEmail: 'congress-40@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-15/', markdownBody: `### Section 1.
The right of citizens of the United States to vote shall not be denied or abridged by the United States or by any State on account of race, color, or previous condition of servitude.

### Section 2.
The Congress shall have power to enforce this article by appropriate legislation.` },
    { type: 'amendment', number: 16, romanNumeral: 'XVI', heading: 'Income Taxes', proposed: '1909-07-02', ratified: '1913-02-03', proposing_body: '61st Congress', proposingBody: '61st Congress', authorName: '61st Congress', authorEmail: 'congress-61@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-16/', markdownBody: `The Congress shall have power to lay and collect taxes on incomes, from whatever source derived, without apportionment among the several States, and without regard to any census or enumeration.` },
    { type: 'amendment', number: 17, romanNumeral: 'XVII', heading: 'Direct Election of Senators', proposed: '1912-05-13', ratified: '1913-04-08', proposing_body: '62nd Congress', proposingBody: '62nd Congress', authorName: '62nd Congress', authorEmail: 'congress-62@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-17/', markdownBody: `The Senate of the United States shall be composed of two Senators from each State, elected by the people thereof, for six years; and each Senator shall have one vote.

When vacancies happen in the representation of any State in the Senate, the executive authority of such State shall issue writs of election to fill such vacancies.

This amendment shall not be so construed as to affect the election or term of any Senator chosen before it becomes valid as part of the Constitution.` },
    { type: 'amendment', number: 18, romanNumeral: 'XVIII', heading: 'Prohibition of Intoxicating Liquors', proposed: '1917-12-18', ratified: '1919-01-16', proposing_body: '65th Congress', proposingBody: '65th Congress', authorName: '65th Congress', authorEmail: 'congress-65@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-18/', markdownBody: `### Section 1.
After one year from the ratification of this article the manufacture, sale, or transportation of intoxicating liquors within, the importation thereof into, or the exportation thereof from the United States and all territory subject to the jurisdiction thereof for beverage purposes is hereby prohibited.

### Section 2.
The Congress and the several States shall have concurrent power to enforce this article by appropriate legislation.

### Section 3.
This article shall be inoperative unless it shall have been ratified as an amendment to the Constitution within seven years from the date of the submission hereof to the States by the Congress.` },
    { type: 'amendment', number: 19, romanNumeral: 'XIX', heading: 'Women’s Suffrage', proposed: '1919-06-04', ratified: '1920-08-18', proposing_body: '66th Congress', proposingBody: '66th Congress', authorName: '66th Congress', authorEmail: 'congress-66@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-19/', markdownBody: `The right of citizens of the United States to vote shall not be denied or abridged by the United States or by any State on account of sex.

Congress shall have power to enforce this article by appropriate legislation.` },
    { type: 'amendment', number: 20, romanNumeral: 'XX', heading: 'Commencement of Terms', proposed: '1932-03-02', ratified: '1933-01-23', proposing_body: '72nd Congress', proposingBody: '72nd Congress', authorName: '72nd Congress', authorEmail: 'congress-72@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-20/', markdownBody: `### Section 1.
The terms of the President and Vice President shall end at noon on the 20th day of January, and the terms of Senators and Representatives at noon on the 3d day of January.

### Section 2.
The Congress shall assemble at least once in every year, and such meeting shall begin at noon on the 3d day of January.

### Section 3.
If, at the time fixed for the beginning of the term of the President, the President elect shall have died, the Vice President elect shall become President.

### Section 4.
The Congress may by law provide for the case of the death of any of the persons from whom the House of Representatives may choose a President.

### Section 5.
Sections 1 and 2 shall take effect on the 15th day of October following the ratification of this article.

### Section 6.
This article shall be inoperative unless it shall have been ratified within seven years from the date of its submission.` },
    { type: 'amendment', number: 21, romanNumeral: 'XXI', heading: 'Repeal of Prohibition', proposed: '1933-02-20', ratified: '1933-12-05', proposing_body: '72nd Congress', proposingBody: '72nd Congress', authorName: '72nd Congress', authorEmail: 'congress-72@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-21/', markdownBody: `### Section 1.
The eighteenth article of amendment to the Constitution of the United States is hereby repealed.

### Section 2.
The transportation or importation into any State, Territory, or possession of the United States for delivery or use therein of intoxicating liquors, in violation of the laws thereof, is hereby prohibited.

### Section 3.
This article shall be inoperative unless it shall have been ratified as an amendment to the Constitution by conventions in the several States within seven years from the date of the submission hereof to the States by the Congress.` },
    { type: 'amendment', number: 22, romanNumeral: 'XXII', heading: 'Presidential Term Limits', proposed: '1947-03-21', ratified: '1951-02-27', proposing_body: '80th Congress', proposingBody: '80th Congress', authorName: '80th Congress', authorEmail: 'congress-80@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-22/', markdownBody: `### Section 1.
No person shall be elected to the office of the President more than twice.

### Section 2.
This article shall be inoperative unless it shall have been ratified as an amendment to the Constitution within seven years from the date of its submission to the States by the Congress.` },
    { type: 'amendment', number: 23, romanNumeral: 'XXIII', heading: 'Presidential Electors for the District of Columbia', proposed: '1960-06-16', ratified: '1961-03-29', proposing_body: '86th Congress', proposingBody: '86th Congress', authorName: '86th Congress', authorEmail: 'congress-86@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-23/', markdownBody: `### Section 1.
The District constituting the seat of Government of the United States shall appoint in such manner as the Congress may direct a number of electors of President and Vice President equal to the whole number of Senators and Representatives in Congress to which the District would be entitled if it were a State.

### Section 2.
The Congress shall have power to enforce this article by appropriate legislation.` },
    { type: 'amendment', number: 24, romanNumeral: 'XXIV', heading: 'Abolition of Poll Taxes', proposed: '1962-08-27', ratified: '1964-01-23', proposing_body: '87th Congress', proposingBody: '87th Congress', authorName: '87th Congress', authorEmail: 'congress-87@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-24/', markdownBody: `### Section 1.
The right of citizens of the United States to vote in any primary or other election for President or Vice President, for electors for President or Vice President, or for Senator or Representative in Congress, shall not be denied or abridged by the United States or any State by reason of failure to pay any poll tax or other tax.

### Section 2.
The Congress shall have power to enforce this article by appropriate legislation.` },
    { type: 'amendment', number: 25, romanNumeral: 'XXV', heading: 'Presidential Disability and Succession', proposed: '1965-07-06', ratified: '1967-02-10', proposing_body: '89th Congress', proposingBody: '89th Congress', authorName: '89th Congress', authorEmail: 'congress-89@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-25/', markdownBody: `### Section 1.
In case of the removal of the President from office or of his death or resignation, the Vice President shall become President.

### Section 2.
Whenever there is a vacancy in the office of the Vice President, the President shall nominate a Vice President who shall take office upon confirmation by a majority vote of both Houses of Congress.

### Section 3.
Whenever the President transmits to the President pro tempore of the Senate and the Speaker of the House of Representatives his written declaration that he is unable to discharge the powers and duties of his office, such powers and duties shall be discharged by the Vice President as Acting President.

### Section 4.
Whenever the Vice President and a majority of either the principal officers of the executive departments or of such other body as Congress may by law provide transmit their written declaration that the President is unable to discharge the powers and duties of his office, the Vice President shall immediately assume the powers and duties of the office as Acting President.` },
    { type: 'amendment', number: 26, romanNumeral: 'XXVI', heading: 'Right to Vote at Age 18', proposed: '1971-03-23', ratified: '1971-07-01', proposing_body: '92nd Congress', proposingBody: '92nd Congress', authorName: '92nd Congress', authorEmail: 'congress-92@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-26/', markdownBody: `### Section 1.
The right of citizens of the United States, who are eighteen years of age or older, to vote shall not be denied or abridged by the United States or by any State on account of age.

### Section 2.
The Congress shall have power to enforce this article by appropriate legislation.` },
    { type: 'amendment', number: 27, romanNumeral: 'XXVII', heading: 'Congressional Compensation', proposed: '1789-09-25', ratified: '1992-05-07', proposing_body: '1st Congress', proposingBody: '1st Congress', authorName: '1st Congress', authorEmail: 'congress-1@congress.gov', source: 'https://constitution.congress.gov/browse/amendment-27/', markdownBody: `No law, varying the compensation for the services of the Senators and Representatives, shall take effect, until an election of Representatives shall have intervened.` },
  ],
};

export default constitutionDataset;
