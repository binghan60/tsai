import nodemailer from 'nodemailer';

let transporter;

function smtpOptions() {
  const gmailEmail = process.env.SMTP_EMAIL?.trim();
  const gmailPassword = process.env.SMTP_PASSWORD?.replace(/\s/g, '');
  const user = gmailEmail || process.env.SMTP_USER?.trim();
  const pass = gmailPassword || process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST?.trim() || (gmailEmail ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT || (gmailEmail ? 465 : 587));

  if (!host || !user || !pass || !Number.isInteger(port)) {
    const error = new Error('寄信功能尚未設定；使用 Gmail 時請填寫 SMTP_EMAIL 與 SMTP_PASSWORD（Google 應用程式密碼）');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE == null
      ? port === 465
      : String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user, pass },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function mailTransporter() {
  if (!transporter) transporter = nodemailer.createTransport(smtpOptions());
  return transporter;
}

export function assertMailConfigured() {
  smtpOptions();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function sendHealthReportEmail({
  to,
  ownerName,
  petName,
  reportNumber,
  reportUrl,
  pdfBuffer,
}) {
  const fromAddress = process.env.MAIL_FROM?.trim() || process.env.SMTP_EMAIL?.trim() || process.env.SMTP_USER?.trim();
  const fromName = process.env.MAIL_FROM_NAME?.trim() || '謙華動物醫院';
  const safePetName = petName || '您的寵物';
  const greeting = ownerName ? `${ownerName} 您好：` : '您好：';
  const subject = `【謙華動物醫院】${safePetName}的健檢報告`;
  const text = `${greeting}\n\n${safePetName}在謙華動物醫院的健檢報告已完成，PDF報告已附在本封郵件中。\n\n也可以透過以下無期限連結查看：\n${reportUrl}\n\n若需停止分享，請聯絡謙華動物醫院撤銷連結。`;
  const html = `
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(safePetName)}在<strong>謙華動物醫院</strong>的健檢報告已完成，PDF報告已附在本封郵件中。</p>
    <p>也可以透過以下無期限連結查看：</p>
    <p><a href="${escapeHtml(reportUrl)}">開啟健檢報告</a></p>
    <p style="color:#666;font-size:13px">若需停止分享，請聯絡謙華動物醫院撤銷連結。</p>
  `;

  const info = await mailTransporter().sendMail({
    from: { name: fromName, address: fromAddress },
    replyTo: process.env.MAIL_REPLY_TO?.trim() || undefined,
    to,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `${reportNumber || 'health-check-report'}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  if (Array.isArray(info.accepted) && info.accepted.length === 0) {
    const error = new Error('郵件伺服器未接受收件地址');
    error.code = 'MAIL_RECIPIENT_REJECTED';
    throw error;
  }

  return info;
}
