import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../../../.env.local") });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const GAME_ID = "8db9b399-4069-4807-a5a3-d3afd5430a54";
const STEP_IDS = {
  2: "d1d8ddd0-1e3b-401b-8a5f-7f8ce215728b",
  3: "4c498757-c809-4670-9c02-2a056168b6f0",
  5: "37e376cf-801c-4897-8f12-bc12edceba62",
  6: "ed47cf81-4f41-4261-b577-d55e6f0c4bbb",
};

const translations: Array<{
  source_table: string;
  source_id: string;
  source_field: string;
  language: string;
  translated_text: string;
}> = [
  // game.epilogue_text
  {
    source_table: "games",
    source_id: GAME_ID,
    source_field: "epilogue_text",
    language: "fr",
    translated_text: "Vous comprenez maintenant ce que peu de visiteurs de Séville aperçoivent : l'Alcázar n'a jamais été qu'un palais, mais le cœur battant d'un empire économique et culturel qui a façonné trois continents. Les six fragments que vous avez découverts révèlent comment une vision royale a créé un réseau d'influence qui définit encore aujourd'hui cette cité.\n\nLorsque Pierre Ier commanda son chef-d'œuvre mudéjar en 1356, il ne se contentait pas de bâtir une résidence — il créait un modèle. Les mêmes artisans qui ont sculpté le Salón de Embajadores allaient influencer chaque demeure noble de Séville, du Palacio de Lebrija aux innombrables maisons perdues dans le temps. La convivencia que vous avez découverte à Santa María la Blanca n'était pas une simple tolérance ; c'était la politique délibérée de Pierre Ier d'exploiter le génie combiné de trois civilisations pour sa révolution architecturale.\n\nMais voici ce qui a transformé la vision en pouvoir durable : le tabac. Ces cigarreras qui travaillaient dans la plus grande manufacture d'Europe ne se contentaient pas de rouler des feuilles — elles finançaient un empire. Vingt-cinq pour cent des revenus royaux espagnols passaient par leurs mains habiles, directement vers les rénovations de l'Alcázar, les agrandissements des jardins et les commandes artistiques. La lumière dorée qui filtrait à travers les jardins du palais et inspirait les peintres de cour comme Alejo Fernández était littéralement payée par les revenus dorés du tabac. Lorsque la Real Academia fut fondée en 1835, elle hérita non seulement de l'art des monastères dissous, mais aussi de siècles de trésors palatiaux — les œuvres de Murillo qui ornaient autrefois les chapelles privées de l'Alcázar, désormais préservées pour la postérité.\n\nLe trésor caché laissé par les rois maures n'était ni l'or ni les bijoux — c'était un système d'artisanat et de synthèse culturelle si puissant qu'il a survécu à la conquête, à la révolution et à des siècles de changements. Chaque arc mudéjar de Séville, chaque motif géométrique d'une cour noble, porte cet ADN.\n\nAujourd'hui, en passant devant les murs de l'Alcázar, souvenez-vous : vous contemplez la fusion culturelle la plus réussie au monde, un témoignage vivant que la beauté n'émerge pas de la pureté, mais du courage de mêler les traditions. Le palais influence encore le destin de Séville parce qu'il a prouvé que les plus grands trésors ne se bâtissent pas par un seul peuple, mais par de nombreuses mains travaillant comme une seule.",
  },
  // step 2
  {
    source_table: "game_steps",
    source_id: STEP_IDS[2],
    source_field: "riddle_text",
    language: "fr",
    translated_text: "Écoutez — entendez-vous les murmures de courtisans morts depuis longtemps ? En 1356, Pierre Ier commença ici son magnifique palais, tissant l'art islamique au pouvoir chrétien dans la pierre et la céramique. Les mêmes artisans mudéjars qui avaient servi les rois musulmans créaient désormais des chefs-d'œuvre pour leur conquérant chrétien, leurs mains guidées par des siècles de tradition. Ce palais classé au patrimoine mondial de l'UNESCO reste la plus ancienne résidence royale active d'Europe, où les rois d'Espagne reçoivent encore leurs invités sous les mêmes plafonds étoilés qui ont abrité les intrigues médiévales. En approchant de la Porte du Lion, remarquez comment la bête héraldique proclame l'autorité chrétienne sur l'ancien sol islamique. Activez votre caméra AR face à l'entrée historique pour révéler l'année qui a tout changé.",
  },
  {
    source_table: "game_steps",
    source_id: STEP_IDS[2],
    source_field: "anecdote",
    language: "fr",
    translated_text: "Pierre Ier de Castille (1334-1369) commanda ce palais mudéjar en 1356, employant les mêmes artisans musulmans et juifs qui avaient perfectionné leur art sous le règne islamique. Le Salón de Embajadores du palais, achevé durant le règne de Pierre, illustre la remarquable synthèse de motifs géométriques islamiques et de symbolisme royal chrétien qui a défini l'identité architecturale unique de Séville. Bien que surnommé « Pierre le Cruel » par ses ennemis, il fut célébré comme « le Juste » par les musulmans et les juifs qui trouvèrent protection sous son règne. (Source : site officiel de l'Alcázar)",
  },
  {
    source_table: "game_steps",
    source_id: STEP_IDS[2],
    source_field: "ar_treasure_reward",
    language: "fr",
    translated_text: "Une clé d'or ornée de motifs géométriques mudéjars et des armoiries royales de Castille.",
  },
  // step 3
  {
    source_table: "game_steps",
    source_id: STEP_IDS[3],
    source_field: "riddle_text",
    language: "fr",
    translated_text: "Imaginez ces allées en 1503, lorsque les peintres de cour erraient parmi les orangers en quête de la lumière parfaite pour les portraits royaux. L'apprenti peintre connaissait chaque ombre ici, comment le soleil du matin transformait l'écume de la fontaine en or liquide, comment la brise du soir portait le parfum de jasmin jusqu'aux fenêtres du palais. Ces jardins furent dessinés sous le règne des Rois Catholiques, lorsque les artisans mudéjars créèrent des fontaines qui captureraient et refléteraient le soleil andalou pour les siècles à venir. Trouvez la fontaine centrale et laissez votre caméra AR révéler le secret du peintre.",
  },
  {
    source_table: "game_steps",
    source_id: STEP_IDS[3],
    source_field: "anecdote",
    language: "fr",
    translated_text: "Les jardins de l'Alcázar furent largement remaniés au début du XVIᵉ siècle sous Charles Quint, incorporant des éléments Renaissance aux fontaines mudéjars traditionnelles. Des peintres de cour comme Alejo Fernández, actif à Séville de 1508 à 1543, auraient utilisé ces jardins comme décor pour leurs portraits royaux, profitant de la lumière filtrée à travers les orangers.",
  },
  // step 5
  {
    source_table: "game_steps",
    source_id: STEP_IDS[5],
    source_field: "riddle_text",
    language: "fr",
    translated_text: "« J'ai vu la tempête », écrivit le premier conservateur de l'académie en 1835, alors que les troupes de Napoléon se retiraient et que l'Espagne reprenait possession de ses trésors artistiques. Cette institution préserve les peintures et sculptures qui ornaient autrefois les cours royales et les demeures nobles, dont des œuvres qui décoraient les appartements privés de l'Alcázar. Les mêmes traditions artistiques qui ont produit les décors mudéjars du palais ont évolué ici en chefs-d'œuvre baroques et romantiques. Derrière ces murs néoclassiques reposent des toiles de Murillo, Zurbarán et d'autres maîtres qui ont capturé l'âge d'or de Séville sur la toile et le bois. Le bâtiment lui-même reflète les éléments Renaissance ajoutés à l'Alcázar, montrant comment les styles artistiques circulaient entre espaces royaux et civiques. Placez-vous devant l'entrée de l'académie et laissez l'AR révéler l'année qui a changé l'art espagnol pour toujours.",
  },
  {
    source_table: "game_steps",
    source_id: STEP_IDS[5],
    source_field: "anecdote",
    language: "fr",
    translated_text: "La Real Academia de Bellas Artes de Santa Isabel de Hungría fut fondée en 1835 lors des réformes libérales qui suivirent la mort de Ferdinand VII. L'académie hérita de nombreuses œuvres d'art issues de monastères dissous et de collections nobles confisquées, y compris des pièces qui ornaient à l'origine les appartements royaux de l'Alcázar. Parmi ses trésors figurent des œuvres de Bartolomé Esteban Murillo (1617-1682), le peintre le plus célèbre de Séville, dont les scènes religieuses étaient autrefois accrochées dans les chapelles privées du palais. (Source : Real Academia de Bellas Artes)",
  },
  // step 6
  {
    source_table: "game_steps",
    source_id: STEP_IDS[6],
    source_field: "riddle_text",
    language: "fr",
    translated_text: "Les mêmes mains qui ont sculpté le paradis dans l'Alcázar ont trouvé ici un nouveau but. Ce palais Renaissance révèle le secret ultime de la splendeur de Séville — comment les familles nobles rivalisaient pour faire écho à la magnificence royale dans leurs propres demeures, créant une symphonie urbaine d'arcs mudéjars, de cours Renaissance et de façades baroques. Le Comte de Lebrija commanda des artisans formés dans les ateliers royaux, leurs techniques transmises à travers des générations de maîtres qui passaient du palais à la commande privée. Chaque chapiteau sculpté ici murmure les mêmes prières géométriques qui sanctifient les chambres du roi, chaque surface carrelée reflète le même paradis islamique qui inspira les jardins royaux. Vous comprenez maintenant — les trésors de l'Alcázar n'ont jamais été confinés derrière les murs royaux, mais dispersés comme des graines à travers la ville, fleurissant dans chaque maison noble qui osa rêver de gloire palatiale. Faites face à l'entrée principale et laissez votre caméra AR révéler l'ultime révélation.",
  },
  {
    source_table: "game_steps",
    source_id: STEP_IDS[6],
    source_field: "anecdote",
    language: "fr",
    translated_text: "Le Palacio de Lebrija, construit au XVIᵉ siècle par les Comtes de Lebrija, abrite la plus belle collection de mosaïques romaines en mains privées, transportées d'Italica et d'autres sites archéologiques. Le palais témoigne de la façon dont la noblesse sévillane imitait les styles architecturaux royaux, employant les mêmes artisans mudéjars qui travaillaient sur les rénovations de l'Alcázar. María de Padilla (c.1334-1361), la favorite bien-aimée de Pierre Ier, possédait autrefois des biens dans ce quartier, et les chambres souterraines du palais font écho aux célèbres bains qui portent son nom à l'Alcázar. (Source : musée du Palacio de Lebrija)",
  },
  {
    source_table: "game_steps",
    source_id: STEP_IDS[6],
    source_field: "ar_treasure_reward",
    language: "fr",
    translated_text: "Une boussole architecturale incrustée de pierres précieuses qui n'indique pas le nord, mais l'exemple le plus proche d'art mudéjar.",
  },
];

(async () => {
  console.log(`Inserting ${translations.length} FR translations...`);
  const { error } = await sb.from("translations_cache").upsert(translations, { onConflict: "source_id,source_field,language" });
  if (error) {
    console.log("ERR:", error);
    return;
  }
  console.log("✅ All 11 FR translations cached.");
  // Now flip is_published=true + reset needs_review
  const { error: pubErr } = await sb.from("games")
    .update({ is_published: true, needs_review: false, review_reason: null })
    .eq("id", GAME_ID);
  if (pubErr) {
    console.log("ERR flip:", pubErr);
    return;
  }
  console.log("✅ Game flipped to is_published=true + needs_review=false");
  console.log();
  console.log("OddballTrip will detect the game at next poll (<2 min) and create the activation code for Martine.");
})();
