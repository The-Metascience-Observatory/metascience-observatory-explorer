import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

// OpenAlex field-subfield mapping (Level 0 -> Level 1)
// Based on OpenAlex concept hierarchy
const FIELD_SUBFIELD_MAP: Record<string, string[]> = {
  // Art
  "C142362112": ["C52119013", "C153349607", "C15708023", "C124952713"],
  // Biology
  "C86803240": ["C59822182", "C95444343", "C78458016", "C54355233", "C89423630", "C153911025", "C186060115", "C18903297", "C90856448", "C70721500", "C60644358", "C150903083", "C42407357", "C105702510", "C159047783", "C87355193", "C140793950"],
  // Business
  "C144133560": ["C178550888", "C187736073", "C162853370", "C121955636", "C54750564", "C56739046", "C110354214", "C10138342", "C21547014", "C539667460", "C112698675", "C39549134"],
  // Chemistry
  "C185592680": ["C55493867", "C178790620", "C179104552", "C147789679", "C155647269", "C188027245", "C75473681", "C21951064", "C71240020", "C43617362", "C13965031", "C177322064", "C8010536"],
  // Computer science
  "C41008148": ["C154945302", "C119857082", "C204321447", "C31972630", "C115903868", "C124101348", "C77088390", "C31258907", "C38652104", "C118524514", "C113775141", "C121684516", "C9390403", "C80444323", "C107457646", "C111919701", "C199360897", "C79403827", "C120314980", "C173608175", "C149635348", "C23123220", "C44154836", "C136764020", "C2522767166", "C49774154", "C28490314"],
  // Economics
  "C162324750": ["C175444787", "C139719470", "C149782125", "C144237770", "C106159729", "C145236788", "C47768531", "C18547055", "C100001284", "C50522688", "C556758197", "C134560507", "C175605778", "C4249254", "C190253527", "C549774020", "C6303427", "C105639569", "C133425853", "C165556158", "C167562979", "C74363100", "C118084267", "C45355965", "C26271046", "C155202549", "C34447519", "C73283319", "C148383697"],
  // Engineering
  "C127413603": ["C119599485", "C24326235", "C78519656", "C147176958", "C42360764", "C136229726", "C146978453", "C13736549", "C117671659", "C133731056", "C201995342", "C66938386", "C116915560", "C78762247", "C187320778", "C16674752", "C107053488", "C200601418", "C112930515", "C22212356", "C170154142", "C171146098", "C88463610", "C199104240", "C77595967", "C183696295", "C199639397", "C55587333", "C21880701", "C76155785", "C61696701"],
  // Environmental science
  "C39432304": ["C18903297", "C87717796", "C107826830", "C91375879", "C99454951", "C95124753", "C526734887", "C548081761", "C524765639", "C49204034", "C97137747", "C6557445", "C37621935", "C159390177", "C144027150", "C54286561", "C48824518"],
  // Geography
  "C205649164": ["C100970517", "C58640448", "C62649853", "C166957645", "C149923435", "C111368507", "C91586092"],
  // Geology
  "C127313418": ["C17409809", "C8058405", "C114793014", "C199289684", "C5900021", "C151730666", "C165205528", "C13280743", "C1965285"],
  // History
  "C95457728": ["C195244886", "C53553401", "C74916050", "C6303427"],
  // Materials science
  "C192562407": ["C159985019", "C191897082", "C171250308", "C126348684", "C8010536"],
  // Mathematics
  "C33923547": ["C202444582", "C28826006", "C134306372", "C2524010", "C118615104", "C114614502", "C126255220", "C105795698", "C94375191", "C145420912", "C37914503"],
  // Medicine
  "C71924100": ["C126322002", "C142724271", "C143998085", "C164705383", "C203014093", "C169760540", "C98274493", "C118552586", "C141071460", "C61434518", "C126838900", "C134018914", "C90924648", "C118487528", "C187212893", "C29456083", "C131872663", "C126894567", "C16005928", "C199343813", "C159110408", "C99508421", "C1862650", "C119767625", "C29694066", "C42219234", "C177713679", "C194828623", "C545542383", "C509550671", "C512399662", "C502942594", "C2989005", "C19527891", "C16685009", "C548259974", "C74909509", "C33070731", "C556039675", "C42972112"],
  // Philosophy
  "C138885662": ["C111472728", "C107038049", "C27206212", "C24667770", "C138921699", "C11171543"],
  // Physics
  "C121332964": ["C62520636", "C26873012", "C109214941", "C185544564", "C44870925", "C1276947", "C184779094", "C41999313", "C74650414", "C57879066", "C97355855", "C121864883", "C33332235", "C120665830", "C49040817", "C159110408", "C30475298", "C159467904", "C61696701", "C3079626", "C46141821"],
  // Political science
  "C17744445": ["C199539241", "C3116431", "C138921699", "C73484699", "C36289849"],
  // Psychology
  "C15744967": ["C70410870", "C138496976", "C75630572", "C180747234", "C77805123", "C188147891", "C542102704", "C19417346"],
  // Sociology
  "C144024400": ["C19165224", "C149923435", "C107993555", "C2549261", "C46312422", "C29595303", "C161191863", "C41895202", "C36289849"],
};

export async function GET() {
  try {
    const db = getDb();

    // Get all fields with paper counts
    const fields = db.prepare(`
      SELECT fieldid, display_name, level, paper_count, total_citations
      FROM field_summary
      ORDER BY paper_count DESC
    `).all() as Array<{
      fieldid: string;
      display_name: string;
      level: number;
      paper_count: number | null;
      total_citations: string | null;
    }>;

    // Separate into level 0 and level 1
    const level0Fields = fields.filter(f => f.level === 0);
    const level1Fields = fields.filter(f => f.level === 1);

    // Build the hierarchy response
    const hierarchy = level0Fields.map(field => {
      const subfieldsIds = FIELD_SUBFIELD_MAP[field.fieldid] || [];
      const subfields = subfieldsIds
        .map(id => level1Fields.find(sf => sf.fieldid === id))
        .filter((sf): sf is NonNullable<typeof sf> => sf !== undefined)
        .sort((a, b) => (b.paper_count || 0) - (a.paper_count || 0));

      return {
        fieldid: field.fieldid,
        display_name: field.display_name,
        paper_count: field.paper_count,
        total_citations: field.total_citations ? parseInt(field.total_citations, 10) : null,
        subfields: subfields.map(sf => ({
          fieldid: sf.fieldid,
          display_name: sf.display_name,
          paper_count: sf.paper_count,
          total_citations: sf.total_citations ? parseInt(sf.total_citations, 10) : null,
        })),
      };
    });

    return NextResponse.json({ fields: hierarchy });
  } catch (error) {
    return errorResponse(error, "fields/hierarchy");
  }
}
