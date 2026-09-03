/**
 * 「这个人是不是 Slides 天才」——只写一遍。
 *
 * 三处要问同一个问题：开小屋（api/room.js）、看排行榜（api/scores.js），
 * 将来还会有第三处。三处各写一份的下场是可以预见的：有一天其中一份放行了
 * 另外两份挡住的人，而两边都觉得自己是对的。
 *
 * 三种身份里只有两种能在这儿验：银行卡订阅去问 Creem，内部码开通的账号对
 * 自己的登录令牌。第三种——从 App Store／Google Play 买的——验不了，那要
 * 苹果和谷歌的服务端接口和随之而来的凭证。在接上之前，商店版的说法就先信
 * 它。这么做放走的是「有人没付钱也开得了小屋」，说清楚比藏着好，也不值得
 * 为它把每一个老老实实付了钱的商店用户挡在门外。
 */
import { configured as creemConfigured, findSubscription } from './_creem.js';
import { codeHolder, loadAccount, normalizeEmail } from './_accounts.js';

/**
 * 认出「你是谁」，并且证明得了。
 *
 * 返回一个稳定的 id：绑了邮箱的就是那个邮箱，还没绑的内部码就是
 * `code:XXXXXX`。这个 id 是战绩和排行榜上认人的那把钥匙，所以它必须是
 * 「同一个人换台设备也是同一个」，而不是随手生成的一串。
 *
 * 令牌对不上就返回 null——没有「先当作是他，回头再说」这一档。
 */
export async function identify({ email, accountToken, holderCode }) {
  if (!accountToken) return null;

  const address = normalizeEmail(email);
  if (address) {
    const account = await loadAccount(address);
    if (account?.token && account.token === accountToken) return { id: address, account };
  }

  // 兑了码还没绑邮箱的人。权益记在码底下，所以也去码底下认。
  if (holderCode) {
    const key = codeHolder(holderCode);
    const held = await loadAccount(key);
    if (held?.token && held.token === accountToken) return { id: key, account: held };
  }

  return null;
}

/** 我们自己发出去的权益（内部码或已绑定的账号）这一刻还有效吗。 */
export const ownGrantLive = (account) => Boolean(account && (account.until || 0) > Date.now());

/**
 * 这个人现在是不是天才。identify 已经认过的，把 account 一起传进来省一次读。
 *
 * 一条铁律：邮箱地址本身不是证据。它印在收据上、写在每一封发出去的信里，
 * 谁都知道得到——所以每一条会放行的路，都得先拿令牌证明「这个邮箱是打请
 * 求这个人自己的」。原来「去问 Creem」那一条没有过这一关，于是只要报出任
 * 何一个正在付费的邮箱，就能白拿一份天才权益（开小屋、看锁着的排行榜），
 * 而真正付钱的那位完全不知情。api/subscription.js 顶上早就把这条道理写下
 * 来了，这里当时没照做。
 */
export async function isGenius({ email, accountToken, holderCode, storeClaim }, account) {
  if (ownGrantLive(account)) return true;

  const address = normalizeEmail(email);
  /** 这个邮箱确实属于打请求的人——只有证明了才敢拿它去问 Creem。 */
  let emailProven = false;

  if (holderCode && accountToken) {
    const held = await loadAccount(codeHolder(holderCode));
    if (held?.token && held.token === accountToken && ownGrantLive(held)) return true;
  }

  if (address && accountToken) {
    const own = await loadAccount(address);
    if (own?.token && own.token === accountToken) {
      emailProven = true;
      if (ownGrantLive(own)) return true;
    }
  }

  // 刷卡订阅的权益记在 Creem 那边，我们自己的库里只有账号和令牌，所以这一
  // 步非问不可；但问的前提是上面那一关过了。没过就当没这回事——不是 403，
  // 是「这个说法不算数」，别的路（内部码、商店）照走。
  if (emailProven && creemConfigured()) {
    try {
      const { sub } = await findSubscription(address);
      if (sub) return true;
    } catch {
      // Creem 挂了不该把已经付过钱的人关在门外。
      if (storeClaim) return true;
    }
  }

  return Boolean(storeClaim);
}
