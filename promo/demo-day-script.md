# ClaimPilot PRO — Demo Day script (6:00 + 4:00 Q&A)

Speakers: 1 (or split the demo and the story between two). Every claim in this script was checked against the
repository; the last section lists where each number comes from.

**Fill in the blanks in `04` before you print this.** They are the only numbers the repo cannot supply.

## Before your slot

- `pnpm db:seed` — resets the demo book; CLM-2026-0147 goes back to Pending with its fixture
- Run the audit once on CLM-2026-0147 so you know how long it takes on that laptop
- Log in before you are called; leave the claim page open
- Download the 60-second video to the laptop. If the network dies, you present from that file
- In the default demo mode an **uploaded** invoice returns `422 OCR_DISABLED` when the audit runs. Demo the audit on the
  seeded claim; show the upload screen as a still, or switch to live mode and test it beforehand

---

## 0:00–0:45 — Problem and user

**EN**

> The system is for the people who file invoices. An employee buys parts for a test, or visits a supplier. They pay,
> keep the receipt, submit it, and then wait. Sometimes it comes back — a document is missing. Sometimes nothing
> happens at all.
> The other user is the reviewer in finance, whose queue is mostly invoices that need no decision at all.
> Four screens, three questions: how are we doing, is this invoice right, and what should we do about it. The risk
> panel and the audit trail answer the third.

**中文**

> 这套系统是给要交发票的人用的。员工为一次试验买零件，或者去见供应商。他们垫钱，收好发票，交上去，然后开始等。
> 有时它被退回——少了单据。有时它什么都不发生。
> 另一个使用者是财务的审核人，她队列里大多是不需要决定的单。
> 四个界面，三个问题：我们做得怎么样、这张发票对不对、接下来该怎么办。风险评估和审计记录回答第三个。

`[PPT 1]` The poster, or a photo of a paper invoice on a desk.

## 0:45–3:15 — Live demo

`[Browser]` Signed in, CLM-2026-0147 open.

**EN — the cockpit**

> I'm signing in as a finance reviewer. This is the cockpit, and it answers one question: where is it stuck.
> Total spend, auto-clear rate, exception rate, high-risk exposure, cycle time — computed live over a demo book of 130
> claims worth 3.8 million dollars. 65.8 % clear the rules with no exception; a person still posts to SAP. 9.6 hours
> from submission to analysed. The same page carries the manual end-to-end baseline: 4.2 days.

**EN — the audit**

> Now an invoice. I upload it, then fill in the claim: category, project code, vendor, amount. The audit checks what I
> typed against what the scan reads — a mismatch between the invoice and the claim is itself a finding.
> Submit. Run the audit. `[wait]`
> What comes back is not a paragraph. Vendor, invoice number, date, PO, total — each field carries a chip: found in the
> scanned text or not, next to the scan's page-level confidence, one number for the whole page. The annotated invoice
> draws the same fields onto the page, so I can see where every number came from.
> And when it cannot read a field, it says so instead of guessing. That is the difference between a helpful tool and a
> confident one.

**EN — the risk score**

> Beside the fields: a score and a level. Twenty rules check it; the ones that fire add up to the score. The model
> reads the text and explains the result. It never sets the number.
> Open "How this was calculated" and you get the rules that fired, the points, and the reason.

**EN — the trail**

> Every step is written down: who submitted, what the system found, who cleared it, when it was posted. The app has no
> way to edit or delete an entry. Posting stays locked until every exception is cleared — here, one open exception, and
> the button is disabled.

**中文**

> 我以财务审核员身份登录。这是看板，回答一个问题：哪里卡住了。
> 总支出、自动放行率、异常率、高风险敞口、处理周期——从 130 张、380 万美元的演示账套实时算出。65.8% 无异常通过规则；
> 但过账仍然由人点。9.6 小时是从提交到分析完成；同一页还显示人工端到端基线 4.2 天。
> 现在一张发票。我上传，然后填申报内容：类别、项目号、供应商、金额。审计会把我填的和扫描件读到的对一遍——
> 发票和申报不一致，本身就是一条异常。
> 提交，跑审计。
> 回来的不是一个段落。供应商、发票号、日期、PO、总额——每个字段带一个标签：在扫描文本里找到了没有，
> 旁边是整页级置信度（整页一个数，不是每个字段一个）。标注版发票把同样的字段画在页面上。
> 读不出的字段，它会说读不出，而不是猜一个。
> 字段旁边是分数和等级。二十条规则检查它，命中的规则加起来就是这个分。模型只解释，不改分。
> 每一步都写下来。这个应用没有提供编辑或删除入口。异常没清完，过账按钮是禁用的。

## 3:15–4:15 — Users and changes

`[PPT 2]` Four before/after pairs, one screenshot each.

**EN**

> We put this in front of ten testers. Four things came back, and all four are in the build you are looking at.
> The primary button failed contrast on a bright projector — 2.8 to one. We measured it, and changed the colour.
> Two entries in the audit log differed by one letter; in a long list nobody could tell them apart. One of them is
> renamed.
> A successful posting came out in red, because the colour was hard-coded. People assumed it had failed.
> And a confidence number sat on the screen without saying where it came from. It now reads "OCR: fixture
> (simulated)" — a demonstration fixture, not a measurement.

**中文**

> 我们把它交给十位测试者。四条反馈，四条都已经在你们看到的这一版里。
> 主按钮在明亮投影下对比度不达标，2.8:1。我们量了，换了颜色。
> 审计日志里两个条目只差一个字母，清单那么长没人分得清，改掉了其中一个。
> 过账成功却显示红色，因为颜色写死了，大家以为失败。
> 还有一个置信度数字挂在屏幕上不说从哪来。现在它写着"OCR: fixture (simulated)"——是演示夹具，不是真实测量。

## 4:15–5:00 — Promotion

`[PPT 3]` One dated screenshot per channel. Numbers you can defend with a screenshot; nothing else.

**EN**

> We put it where our people already are, on three channels plus the code.
> The video went to Bilibili and Douyin. The poster QR opens the landing page; the feedback form is on Wenjuanxing,
> because it opens on any network. The code is on GitHub, for anyone who wants to read it.
> As of today: `__` views, `__` scans through the QR, and `__` people finished the form. Ten of them are on the
> previous slide.
> What worked was the QR — no account, no link, one tap. What did not was the network, and that is the next slide.

**中文**

> 我们把它放在人已经在的地方：三个渠道，加上代码。
> 视频发在 B 站和抖音；海报二维码打开落地页；反馈表放在问卷星，因为它在任何网络下都能打开。代码在 GitHub，
> 想看的人可以看。
> 到今天为止：播放 `__` 次，扫码 `__` 次，完成问卷 `__` 人。其中十位就在上一页。
> 有用的是二维码——不用账号、不用点链接。没用的是网络，这就是下一页。

## 5:00–6:00 — What was hard, what we learned

`[PPT 4]` Two columns from the illumination table: 20/98 against 98/98.

**EN**

> The hardest thing was not the code. It was the photographs.
> The first version only worked on flat scans. We put a shadow across a third of one invoice: it recovered 20 of 98
> critical values, and every one of twenty otherwise-clean invoices was escalated to a human.
> So we normalise the lighting before OCR. The same page now gives 98 of 98, and all twenty clear.
> On ordinary phone photos our false-alarm rate is still 12.2 %. That is above the line we set ourselves, and it is in
> the report.
> That is the lesson I am taking away. Not a design problem, not a model problem — a problem with the conditions our
> users actually work in. We only found it because we degraded our own documents instead of trusting a clean scan.
> And building with AI: it writes fast, and it sounds just as confident when it is wrong. Most of the work was not
> writing. It was checking — and turning "I am not sure" into a rule.

**中文**

> 最难的不是代码，是照片。
> 第一版只对平扫件有效。我们把阴影盖在发票的三分之一上：98 个关键值只读出 20 个，二十张本来干净的单全部被升级给人。
> 所以我们在 OCR 之前先做光照归一化。同一页现在是 98 个读出 98 个，二十张全部自动通过。
> 普通手机照片下，误报率仍然是 12.2%。这高于我们给自己定的线，报告里写着。
> 这是我带走的收获：不是设计问题，也不是模型问题，是用户真实工作条件的问题。而我们发现它，是因为我们拿自己的单据去做退化，
> 而不是相信一张干净的扫描件。
> 还有用 AI 开发这件事：它写得快，错的时候语气也一样自信。大部分功夫不在写，在核对——把"我不确定"变成一条规则。

## 6:00 — Close

**EN:** ClaimPilot PRO. The link is on the QR. Thank you.
**中文:** 这就是 ClaimPilot PRO。链接在二维码上。谢谢。

---

## Facts this script asserts, and where each comes from

| Claim in the script | Source |
|---|---|
| 130 claims, $3,815,541.16 | `pnpm kpi:report`; seed run |
| 65.8 % auto-clear | same |
| 9.6 h cycle, 4.2-day manual baseline | same |
| 20 rules, R-01…R-20; only firing rules add points | `src/lib/risk/rules.ts`; `RISK_RULES.md` |
| "How this was calculated" | risk panel label |
| Page-level OCR confidence for uploads | `src/lib/domain/ocr-source.ts` |
| "OCR: fixture (simulated)" | same |
| No edit/delete route for the audit log | `src/app/(app)/audit` route list |
| Posting locked while an exception is open | claim page, `Post to SAP` disabled |
| Button contrast was 2.8:1 | D-42, `docs/ACCESSIBILITY.md` |
| Two log entries one letter apart | commit `22b8b8f` |
| Success shown in red, now green | commit `36ac45c` |
| 10 testers / 10 responses | Wenjuanxing export |
| Shadow across a third of the page: 20 of 98 critical values, then 98 of 98 | `docs/ILLUMINATION.md`, tables at L34–35 |
| 12.2 % false alarms on realistic phone photos | `docs/GROUNDING_BENCH.md` L23 |
| Uploaded invoice → `422 OCR_DISABLED` in demo mode | `src/lib/audit/run-audit.ts:109` |
