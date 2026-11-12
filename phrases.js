import {EXTRA_PHRASES} from './phrases-extra.js';
// Explicit numeric IDs are legacy aliases; stable keys do not depend on array order.
const LEGACY_PHRASES=[
 {
  "id": 0,
  "key": "builtin:restaurant:legacy-00",
  "category": "餐厅",
  "zh": "五个人。",
  "ja": "5人です。",
  "kana": "ごにんです。"
 },
 {
  "id": 1,
  "key": "builtin:restaurant:legacy-01",
  "category": "餐厅",
  "zh": "有空位吗？",
  "ja": "空いている席はありますか。",
  "kana": "あいているせきはありますか。"
 },
 {
  "id": 2,
  "key": "builtin:restaurant:legacy-02",
  "category": "餐厅",
  "zh": "请给我菜单。",
  "ja": "メニューをお願いします。",
  "kana": "めにゅーをおねがいします。"
 },
 {
  "id": 3,
  "key": "builtin:restaurant:legacy-03",
  "category": "餐厅",
  "zh": "有中文菜单吗？",
  "ja": "中国語のメニューはありますか。",
  "kana": "ちゅうごくごのめにゅーはありますか。"
 },
 {
  "id": 4,
  "key": "builtin:restaurant:legacy-04",
  "category": "餐厅",
  "zh": "请推荐一下。",
  "ja": "おすすめは何ですか。",
  "kana": "おすすめはなんですか。"
 },
 {
  "id": 5,
  "key": "builtin:restaurant:legacy-05",
  "category": "餐厅",
  "zh": "请给我水。",
  "ja": "お水をお願いします。",
  "kana": "おみずをおねがいします。"
 },
 {
  "id": 6,
  "key": "builtin:restaurant:legacy-06",
  "category": "餐厅",
  "zh": "这个请来一份。",
  "ja": "これを一つお願いします。",
  "kana": "これをひとつおねがいします。"
 },
 {
  "id": 7,
  "key": "builtin:restaurant:legacy-07",
  "category": "餐厅",
  "zh": "可以外带吗？",
  "ja": "持ち帰りはできますか。",
  "kana": "もちかえりはできますか。"
 },
 {
  "id": 8,
  "key": "builtin:restaurant:legacy-08",
  "category": "餐厅",
  "zh": "请结账。",
  "ja": "お会計をお願いします。",
  "kana": "おかいけいをおねがいします。"
 },
 {
  "id": 9,
  "key": "builtin:restaurant:legacy-09",
  "category": "餐厅",
  "zh": "可以刷卡吗？",
  "ja": "カードは使えますか。",
  "kana": "かーどはつかえますか。"
 },
 {
  "id": 10,
  "key": "builtin:restaurant:legacy-10",
  "category": "餐厅",
  "zh": "我对坚果过敏。",
  "ja": "ナッツアレルギーがあります。",
  "kana": "なっつあれるぎーがあります。"
 },
 {
  "id": 11,
  "key": "builtin:restaurant:legacy-11",
  "category": "餐厅",
  "zh": "里面有花生吗？",
  "ja": "ピーナッツは入っていますか。",
  "kana": "ぴーなっつははいっていますか。"
 },
 {
  "id": 12,
  "key": "builtin:stay:legacy-12",
  "category": "酒店",
  "zh": "我预订了房间。",
  "ja": "予約しています。",
  "kana": "よやくしています。"
 },
 {
  "id": 13,
  "key": "builtin:stay:legacy-13",
  "category": "酒店",
  "zh": "我想办理入住。",
  "ja": "チェックインをお願いします。",
  "kana": "ちぇっくいんをおねがいします。"
 },
 {
  "id": 14,
  "key": "builtin:stay:legacy-14",
  "category": "酒店",
  "zh": "可以寄存行李吗？",
  "ja": "荷物を預けてもいいですか。",
  "kana": "にもつをあずけてもいいですか。"
 },
 {
  "id": 15,
  "key": "builtin:stay:legacy-15",
  "category": "酒店",
  "zh": "退房时间是几点？",
  "ja": "チェックアウトは何時ですか。",
  "kana": "ちぇっくあうとはなんじですか。"
 },
 {
  "id": 16,
  "key": "builtin:stay:legacy-16",
  "category": "酒店",
  "zh": "请告诉我Wi-Fi密码。",
  "ja": "Wi-Fiのパスワードを教えてください。",
  "kana": "わいふぁいのぱすわーどをおしえてください。"
 },
 {
  "id": 17,
  "key": "builtin:stay:legacy-17",
  "category": "酒店",
  "zh": "可以多给一条毛巾吗？",
  "ja": "タオルをもう一枚いただけますか。",
  "kana": "たおるをもういちまいいただけますか。"
 },
 {
  "id": 18,
  "key": "builtin:stay:legacy-18",
  "category": "酒店",
  "zh": "热水出不来。",
  "ja": "お湯が出ません。",
  "kana": "おゆがでません。"
 },
 {
  "id": 19,
  "key": "builtin:stay:legacy-19",
  "category": "酒店",
  "zh": "暖气不能用。",
  "ja": "暖房が使えません。",
  "kana": "だんぼうがつかえません。"
 },
 {
  "id": 20,
  "key": "builtin:stay:legacy-20",
  "category": "酒店",
  "zh": "房间钥匙在哪里领取？",
  "ja": "部屋の鍵はどこで受け取れますか。",
  "kana": "へやのかぎはどこでうけとれますか。"
 },
 {
  "id": 21,
  "key": "builtin:stay:legacy-21",
  "category": "酒店",
  "zh": "我想办理退房。",
  "ja": "チェックアウトをお願いします。",
  "kana": "ちぇっくあうとをおねがいします。"
 },
 {
  "id": 22,
  "key": "builtin:shopping:legacy-22",
  "category": "购物",
  "zh": "这个多少钱？",
  "ja": "これはいくらですか。",
  "kana": "これはいくらですか。"
 },
 {
  "id": 23,
  "key": "builtin:shopping:legacy-23",
  "category": "购物",
  "zh": "可以试穿吗？",
  "ja": "試着してもいいですか。",
  "kana": "しちゃくしてもいいですか。"
 },
 {
  "id": 24,
  "key": "builtin:shopping:legacy-24",
  "category": "购物",
  "zh": "有其他尺码吗？",
  "ja": "ほかのサイズはありますか。",
  "kana": "ほかのさいずはありますか。"
 },
 {
  "id": 25,
  "key": "builtin:shopping:legacy-25",
  "category": "购物",
  "zh": "有其他颜色吗？",
  "ja": "ほかの色はありますか。",
  "kana": "ほかのいろはありますか。"
 },
 {
  "id": 26,
  "key": "builtin:shopping:legacy-26",
  "category": "购物",
  "zh": "这个有库存吗？",
  "ja": "これは在庫がありますか。",
  "kana": "これはざいこがありますか。"
 },
 {
  "id": 27,
  "key": "builtin:shopping:legacy-27",
  "category": "购物",
  "zh": "可以免税吗？",
  "ja": "免税できますか。",
  "kana": "めんぜいできますか。"
 },
 {
  "id": 28,
  "key": "builtin:shopping:legacy-28",
  "category": "购物",
  "zh": "我带了护照。",
  "ja": "パスポートを持っています。",
  "kana": "ぱすぽーとをもっています。"
 },
 {
  "id": 29,
  "key": "builtin:shopping:legacy-29",
  "category": "购物",
  "zh": "请给我收据。",
  "ja": "レシートをお願いします。",
  "kana": "れしーとをおねがいします。"
 },
 {
  "id": 30,
  "key": "builtin:shopping:legacy-30",
  "category": "购物",
  "zh": "不需要袋子。",
  "ja": "袋は要りません。",
  "kana": "ふくろはいりません。"
 },
 {
  "id": 31,
  "key": "builtin:shopping:legacy-31",
  "category": "购物",
  "zh": "我先看看。",
  "ja": "少し見てもいいですか。",
  "kana": "すこしみてもいいですか。"
 },
 {
  "id": 32,
  "key": "builtin:shopping:legacy-32",
  "category": "购物",
  "zh": "可以退货吗？",
  "ja": "返品できますか。",
  "kana": "へんぴんできますか。"
 },
 {
  "id": 33,
  "key": "builtin:shopping:legacy-33",
  "category": "购物",
  "zh": "这可以在海外使用吗？",
  "ja": "これは海外で使えますか。",
  "kana": "これはかいがいでつかえますか。"
 },
 {
  "id": 34,
  "key": "builtin:station:legacy-34",
  "category": "车站",
  "zh": "车站在哪里？",
  "ja": "駅はどこですか。",
  "kana": "えきはどこですか。"
 },
 {
  "id": 35,
  "key": "builtin:station:legacy-35",
  "category": "车站",
  "zh": "这是去大阪的电车吗？",
  "ja": "これは大阪行きですか。",
  "kana": "これはおおさかゆきですか。"
 },
 {
  "id": 36,
  "key": "builtin:station:legacy-36",
  "category": "车站",
  "zh": "去京都在哪个站台？",
  "ja": "京都行きは何番線ですか。",
  "kana": "きょうとゆきはなんばんせんですか。"
 },
 {
  "id": 37,
  "key": "builtin:station:legacy-37",
  "category": "车站",
  "zh": "需要换乘吗？",
  "ja": "乗り換えは必要ですか。",
  "kana": "のりかえはひつようですか。"
 },
 {
  "id": 38,
  "key": "builtin:station:legacy-38",
  "category": "车站",
  "zh": "请告诉我换乘方法。",
  "ja": "乗り換え方を教えてください。",
  "kana": "のりかえかたをおしえてください。"
 },
 {
  "id": 39,
  "key": "builtin:station:legacy-39",
  "category": "车站",
  "zh": "这班车停志贺站吗？",
  "ja": "この電車は志賀駅に止まりますか。",
  "kana": "このでんしゃはしがえきにとまりますか。"
 },
 {
  "id": 40,
  "key": "builtin:station:legacy-40",
  "category": "车站",
  "zh": "末班车是几点？",
  "ja": "終電は何時ですか。",
  "kana": "しゅうでんはなんじですか。"
 },
 {
  "id": 41,
  "key": "builtin:station:legacy-41",
  "category": "车站",
  "zh": "洗手间在哪里？",
  "ja": "トイレはどこですか。",
  "kana": "といれはどこですか。"
 },
 {
  "id": 42,
  "key": "builtin:station:legacy-42",
  "category": "车站",
  "zh": "有电梯吗？",
  "ja": "エレベーターはありますか。",
  "kana": "えれべーたーはありますか。"
 },
 {
  "id": 43,
  "key": "builtin:station:legacy-43",
  "category": "车站",
  "zh": "我丢了车票。",
  "ja": "切符をなくしました。",
  "kana": "きっぷをなくしました。"
 },
 {
  "id": 44,
  "key": "builtin:station:legacy-44",
  "category": "车站",
  "zh": "可以使用这张交通卡吗？",
  "ja": "このICカードは使えますか。",
  "kana": "このあいしーかーどはつかえますか。"
 },
 {
  "id": 45,
  "key": "builtin:station:legacy-45",
  "category": "车站",
  "zh": "去机场的巴士在哪里乘坐？",
  "ja": "空港行きのバスはどこから乗れますか。",
  "kana": "くうこうゆきのばすはどこからのれますか。"
 },
 {
  "id": 46,
  "key": "builtin:snowboard:legacy-46",
  "category": "滑雪",
  "zh": "我第一次滑单板。",
  "ja": "スノーボードは初めてです。",
  "kana": "すのーぼーどははじめてです。"
 },
 {
  "id": 47,
  "key": "builtin:snowboard:legacy-47",
  "category": "滑雪",
  "zh": "我想租单板装备。",
  "ja": "スノーボード用品をレンタルしたいです。",
  "kana": "すのーぼーどようひんをれんたるしたいです。"
 },
 {
  "id": 48,
  "key": "builtin:snowboard:legacy-48",
  "category": "滑雪",
  "zh": "这个尺寸合适吗？",
  "ja": "このサイズで合っていますか。",
  "kana": "このさいずであっていますか。"
 },
 {
  "id": 49,
  "key": "builtin:snowboard:legacy-49",
  "category": "滑雪",
  "zh": "雪鞋太紧了。",
  "ja": "ブーツがきついです。",
  "kana": "ぶーつがきついです。"
 },
 {
  "id": 50,
  "key": "builtin:snowboard:legacy-50",
  "category": "滑雪",
  "zh": "有适合初学者的课程吗？",
  "ja": "初心者向けのレッスンはありますか。",
  "kana": "しょしんしゃむけのれっすんはありますか。"
 },
 {
  "id": 51,
  "key": "builtin:snowboard:legacy-51",
  "category": "滑雪",
  "zh": "教练会说英语吗？",
  "ja": "英語が話せる先生はいますか。",
  "kana": "えいごがはなせるせんせいはいますか。"
 },
 {
  "id": 52,
  "key": "builtin:snowboard:legacy-52",
  "category": "滑雪",
  "zh": "初学者雪道在哪里？",
  "ja": "初心者コースはどこですか。",
  "kana": "しょしんしゃこーすはどこですか。"
 },
 {
  "id": 53,
  "key": "builtin:snowboard:legacy-53",
  "category": "滑雪",
  "zh": "在哪里归还装备？",
  "ja": "どこで返却すればいいですか。",
  "kana": "どこでへんきゃくすればいいですか。"
 },
 {
  "id": 54,
  "key": "builtin:snowboard:legacy-54",
  "category": "滑雪",
  "zh": "必须几点归还？",
  "ja": "何時までに返却すればいいですか。",
  "kana": "なんじまでにへんきゃくすればいいですか。"
 },
 {
  "id": 55,
  "key": "builtin:snowboard:legacy-55",
  "category": "滑雪",
  "zh": "索道今天运行吗？",
  "ja": "今日ロープウェイは動いていますか。",
  "kana": "きょうろーぷうぇいはうごいていますか。"
 },
 {
  "id": 56,
  "key": "builtin:snowboard:legacy-56",
  "category": "滑雪",
  "zh": "我需要休息一下。",
  "ja": "少し休みたいです。",
  "kana": "すこしやすみたいです。"
 },
 {
  "id": 57,
  "key": "builtin:snowboard:legacy-57",
  "category": "滑雪",
  "zh": "请帮我联系工作人员。",
  "ja": "スタッフを呼んでください。",
  "kana": "すたっふをよんでください。"
 },
 {
  "id": 58,
  "key": "builtin:stay:legacy-58",
  "category": "酒店",
  "zh": "可以说明一下入住方法吗？",
  "ja": "チェックインの方法を教えてください。",
  "kana": "ちぇっくいんのほうほうをおしえてください。"
 },
 {
  "id": 59,
  "key": "builtin:stay:legacy-59",
  "category": "酒店",
  "zh": "可以晚一点退房吗？",
  "ja": "チェックアウトを遅くできますか。",
  "kana": "ちぇっくあうとをおそくできますか。"
 }
];
export const PHRASES=Object.freeze([...LEGACY_PHRASES.map(p=>Object.freeze(p)),...EXTRA_PHRASES]);
