export const RESOURCES = ['food','wood','gold','stone','iron','oil'];
export const AGES = ['Classical','Medieval','Imperial','Industrial'];
export const RESOURCE_ICONS = {food:'◒',wood:'♠',gold:'◆',stone:'⬟',iron:'⚒',oil:'◉'};
const unit = (name,age,category,producer,cost,hp,damage,range,speed,time,icon,extra={}) => ({name,age,category,producer,cost,hp,damage,range,speed,time,icon,size:category==='siege'?13:category==='cavalry'?10:7,vision:category==='cavalry'?280:210,cooldown:category==='siege'?2.8:category==='ranged'?1.5:1.1,...extra});
export const UNITS = {
 worker:unit('Citizen',0,'worker','civic',{food:50},55,3,22,72,9,'⚒',{vision:180,carryCapacity:12,gatherRate:3.2}),
 militia:unit('Shield recruit',0,'infantry','barracks',{food:45,gold:15},85,11,25,68,10,'▣',{upgrade:'legionary'}),
 legionary:unit('Legionary',1,'infantry','barracks',{food:55,gold:20},125,16,25,72,12,'▣',{armor:2,upgrade:'cohort'}),
 cohort:unit('Iron cohort',2,'infantry','barracks',{food:65,gold:25,iron:15},175,22,25,74,14,'▣',{armor:4,upgrade:'rifleman'}),
 rifleman:unit('Line rifleman',3,'infantry','barracks',{food:60,gold:30,iron:20},180,28,155,74,15,'▤',{armor:3}),
 spear:unit('Hasta guard',0,'spear','barracks',{food:40,wood:25},80,9,34,65,9,'♜',{counters:{cavalry:2.8},upgrade:'pike'}),
 pike:unit('Pike guard',1,'spear','barracks',{food:45,wood:30},115,13,37,67,10,'♜',{counters:{cavalry:3},upgrade:'halberd'}),
 halberd:unit('Steel sentinel',2,'spear','barracks',{food:50,wood:25,iron:15},160,18,40,68,12,'♜',{armor:2,counters:{cavalry:3.1}}),
 archer:unit('Bow auxiliary',0,'ranged','range',{wood:40,gold:25},60,10,155,68,11,'⌁',{upgrade:'crossbow'}),
 crossbow:unit('Arbalest auxiliary',1,'ranged','range',{wood:50,gold:30},85,15,185,69,12,'⌁',{upgrade:'marksman'}),
 marksman:unit('Imperial marksman',2,'ranged','range',{wood:45,gold:35,iron:10},110,22,220,70,14,'⌁'),
 scout:unit('Equestrian scout',0,'cavalry','stable',{food:70},100,10,25,112,14,'♞',{vision:340,counters:{ranged:1.7},upgrade:'knight'}),
 knight:unit('Sun cavalry',1,'cavalry','stable',{food:85,gold:40},185,22,27,108,18,'♞',{armor:3,counters:{ranged:1.8},upgrade:'dragoon'}),
 dragoon:unit('Imperial dragoon',2,'cavalry','stable',{food:90,gold:40,iron:20},230,27,95,110,19,'♞',{armor:4,counters:{ranged:1.8}}),
 ram:unit('Oak battering ram',1,'siege','workshop',{wood:110,gold:50},310,42,36,42,22,'▰',{armor:6,counters:{building:3},upgrade:'tank'}),
 catapult:unit('Stone thrower',1,'siege','workshop',{wood:110,gold:70},145,38,260,44,24,'◈',{counters:{building:1.8},splash:48,upgrade:'cannon'}),
 cannon:unit('Bronze field cannon',3,'siege','workshop',{wood:90,gold:80,iron:50},195,70,310,48,25,'◈',{splash:55,counters:{building:2.2}}),
 tank:unit('Iron landship',3,'siege','workshop',{gold:100,iron:90,oil:50},410,44,165,61,30,'▰',{armor:8,counters:{building:2}})
};
const building = (name,age,cost,hp,size,buildTime,icon,extra={}) => ({name,age,cost,hp,size,buildTime,time:buildTime,icon,vision:260,population:0,dropoff:[],produces:[],research:[],...extra});
export const BUILDINGS = {
 civic:building('Civic heart',0,{wood:240,stone:120},1300,48,42,'▥',{population:20,dropoff:RESOURCES,produces:['worker'],vision:360,description:'Train citizens, deposit resources, and advance your civilization.'}),
 house:building('Atrium house',0,{wood:65},380,25,12,'⌂',{population:10,description:'Adds room for ten citizens and soldiers.'}),
 farm:building('Grain estate',0,{wood:55},180,30,10,'▦',{resource:'food',amount:1400,description:'A renewable food source. Assign citizens to harvest it.'}),
 lumber:building('Timber yard',0,{wood:85},400,25,14,'♠',{dropoff:['wood'],research:['forestry'],description:'Shortens the journey from trees to your stockpile.'}),
 mining:building('Quarry office',0,{wood:85},420,25,14,'⚒',{dropoff:['gold','stone','iron'],research:['deepmining'],description:'Receives gold, stone, and iron carried by citizens.'}),
 barracks:building('Legion hall',0,{wood:130},700,36,22,'▣',{produces:['militia','legionary','cohort','rifleman','spear','pike','halberd'],description:'Train infantry and anti-cavalry guards.'}),
 range:building('Bow court',0,{wood:140},620,34,23,'⌁',{produces:['archer','crossbow','marksman'],description:'Train ranged auxiliaries and marksmen.'}),
 stable:building('Equestrian lodge',0,{wood:160},700,37,24,'♞',{produces:['scout','knight','dragoon'],description:'Fast scouting and cavalry to break ranged formations.'}),
 workshop:building('Siege foundry',1,{wood:180,gold:70},800,38,30,'◈',{produces:['ram','catapult','cannon','tank'],prerequisites:['barracks'],description:'Battering rams, stone throwers, artillery, and landships.'}),
 market:building('Exchange forum',1,{wood:150},650,35,23,'⚖',{research:['husbandry'],description:'Organizes logistics to increase citizen carrying capacity.'}),
 forge:building('Imperial forge',0,{wood:120,gold:40},600,30,20,'⚒',{research:['steel','armor','fletching','logistics'],description:'Improve weapons, armor, projectiles, and marching speed.'}),
 tower:building('Watch spire',0,{wood:50,stone:100},650,21,25,'♜',{damage:16,range:240,cooldown:1.5,vision:380,description:'Defensive fire and long-range vision.'}),
 wall:building('Stone curtain',0,{stone:20},700,14,8,'▥',{vision:80,description:'Blocks travel. Leave a gate or a gap for your citizens.'}),
 gate:building('Sun gate',1,{wood:30,stone:45},900,23,12,'Π',{vision:140,passableOwner:true,description:'Friendly citizens and soldiers pass through; enemies must break it.'}),
 fort:building('Aurelian citadel',2,{wood:180,stone:320,gold:80},2000,48,48,'♜',{damage:36,range:295,cooldown:1.3,vision:410,population:20,prerequisites:['barracks','forge'],description:'An imposing stronghold that protects your settlement.'}),
 refinery:building('Oil works',3,{wood:130,iron:70,gold:60},650,32,30,'◉',{dropoff:['oil'],research:['engines'],description:'Receives oil for mechanized armies.'})
};
const tech = (name,age,building,cost,time,effects,description) => ({name,age,building,cost,time,effects,description,icon:'✦'});
export const TECHNOLOGIES = {
 forestry:tech('Iron axes',0,'lumber',{food:70,wood:40},22,{gatherRate:1.25,resource:'wood'},'Citizens gather wood 25% faster.'),
 deepmining:tech('Deep seams',1,'mining',{food:100,wood:60},25,{gatherRate:1.3,resources:['gold','stone','iron']},'Mineral gathering is 30% faster.'),
 husbandry:tech('Supply satchels',1,'market',{food:120,gold:60},28,{carryCapacity:1.5},'Citizens carry 50% more per trip.'),
 steel:tech('Tempered blades',1,'forge',{food:130,gold:70},30,{damage:1.2,categories:['infantry','spear','cavalry']},'Melee weapons inflict 20% more damage.'),
 armor:tech('Layered mail',1,'forge',{food:100,gold:100},30,{armor:2},'All soldiers gain two armor.'),
 fletching:tech('Long reach',0,'forge',{food:80,gold:60},24,{range:1.15,damage:1.12,categories:['ranged']},'Ranged troops gain 15% reach and 12% damage.'),
 logistics:tech('Marching roads',2,'forge',{food:160,gold:120,iron:40},35,{speed:1.15},'All units march 15% faster.'),
 engines:tech('Efficient engines',3,'refinery',{gold:150,iron:100,oil:60},38,{damage:1.2,speed:1.1,categories:['siege']},'Siege engines gain 20% damage and 10% speed.')
};
export const AGE_COSTS = [null,
 {cost:{food:350,gold:150},time:45,prerequisites:['barracks','house']},
 {cost:{food:550,gold:250,stone:120},time:60,prerequisites:['forge','market']},
 {cost:{food:750,gold:350,iron:200},time:70,prerequisites:['workshop','fort']}
];
export const UPGRADE_CHAINS = {infantry:['militia','legionary','cohort','rifleman'],spear:['spear','pike','halberd'],ranged:['archer','crossbow','marksman'],cavalry:['scout','knight','dragoon'],ram:['ram','tank'],artillery:['catapult','cannon']};
export function formatCost(cost={}) { return Object.entries(cost).map(([r,n])=>`${n} ${r}`).join(' · '); }
export function unitForAge(id,age) { const chain=Object.values(UPGRADE_CHAINS).find(c=>c.includes(id)); return chain ? chain.filter(k=>UNITS[k].age<=age).at(-1)||id : id; }
