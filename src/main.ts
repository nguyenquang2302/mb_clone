import MB from "./MB";
import "dotenv/config";

// ======================================================
// CẤU HÌNH LARAVEL
// ======================================================

const laravelPaymentUrl =
    process.env.LARAVEL_MB_PAYMENT_URL ||
    "http://gpt.x/api/mb/payment";

const laravelSecret =
    process.env.LARAVEL_MB_PAYMENT_SECRET || "";

// ======================================================
// CẤU HÌNH MB BANK
// ======================================================

const username = process.env.MB_USERNAME || "";
const password = process.env.MB_PASSWORD || "";

if (!username || !password) {
    throw new Error("Thiếu MB_USERNAME hoặc MB_PASSWORD");
}

if (!laravelSecret) {
    throw new Error("Thiếu LARAVEL_MB_PAYMENT_SECRET");
}

// ======================================================
// MB - CHỈ TẠO 1 INSTANCE
// ======================================================

const mb = new MB({
    username,
    password,
});

// ======================================================
// CẤU HÌNH SERVICE
// ======================================================

const CHECK_INTERVAL = 30 * 1000;

// ======================================================
// SLEEP
// ======================================================

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// ======================================================
// NGÀY HÔM NAY
// DD/MM/YYYY
// ======================================================

function getToday(): string {
    const now = new Date();

    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();

    return `${day}/${month}/${year}`;
}

// ======================================================
// GỬI GIAO DỊCH SANG LARAVEL
// ======================================================

async function sendPaymentToLaravel(
    tx: any,
    orderCode: string
): Promise<boolean> {

    const amount = Number(tx.creditAmount ?? 0);

    const content = String(
        tx.transactionDesc ?? ""
    );

    const refNo = String(
        tx.refNo ?? ""
    ).trim();

    // Không có mã giao dịch thì không thể chống trùng an toàn
    if (!refNo) {
        console.log(
            "⚠️ Giao dịch không có refNo, bỏ qua để tránh ghi trùng."
        );

        return false;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
        console.log(
            `⚠️ ${refNo} số tiền không hợp lệ: ${amount}`
        );

        return false;
    }

    console.log("");
    console.log("========================================");
    console.log("📤 GỬI GIAO DỊCH SANG LARAVEL");
    console.log("========================================");

    console.log("Order:", orderCode || "Chưa có mã đơn");
    console.log("Amount:", amount);
    console.log("RefNo:", refNo);
    console.log("Content:", content);

    try {
        const response = await fetch(
            laravelPaymentUrl,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": `Bearer ${laravelSecret}`,
                },

                body: JSON.stringify({
                    payment: {
                        transaction_id: refNo,
                        amount: amount,
                        content: content,

                        date:
                            tx.transactionDate ??
                            null,

                        account_receiver:
                            tx.accountNumber ??
                            tx.toAccountNumber ??
                            null,

                        gate: "MBBANK",
                    },
                }),
            }
        );

        const responseText = await response.text();

        console.log(
            `📡 Laravel HTTP ${response.status}`
        );

        console.log(
            "Laravel:",
            responseText
        );

        if (!response.ok) {
            console.error(
                "❌ Laravel từ chối giao dịch"
            );

            return false;
        }

        let result: any;

        try {
            result = JSON.parse(responseText);
        } catch {
            console.error(
                "❌ Laravel trả về JSON không hợp lệ"
            );

            return false;
        }

        if (result.success !== true) {
            console.error(
                "❌ Laravel chưa xử lý thành công"
            );

            return false;
        }

        // Phải đọc result.status, không phải result.result
        const acceptedStatuses = [
            "paid",
            "duplicate",
            "already_paid",
            "mismatch",
            "cancelled_order",
            "unmatched",
            "already_recorded",
        ];

        if (!acceptedStatuses.includes(result.status)) {
            console.log(
                "⚠️ Trạng thái Laravel chưa được nhận diện:",
                result.status
            );

            return false;
        }

        console.log(
            "✅ Laravel đã xử lý giao dịch:",
            result.status
        );

        return true;

    } catch (error) {
        console.error(
            "❌ Không kết nối được Laravel:",
            error
        );

        return false;
    }
}

// ======================================================
// LẤY GIAO DỊCH HÔM NAY
// ======================================================

async function getTodayTransactions(): Promise<any[]> {

    const balance = await mb.getBalance();

    if (!balance?.balances?.length) {
        throw new Error(
            "Không lấy được danh sách tài khoản MB"
        );
    }

    const today = getToday();

    const result: any[] = [];

    for (const account of balance.balances) {

        if (!account.number) {
            continue;
        }

        try {
            console.log(
                `🔍 Đang lấy giao dịch tài khoản ${account.number}`
            );

            const transactions =
                await mb.getTransactionsHistory({
                    accountNumber: account.number,
                    fromDate: today,
                    toDate: today,
                });

            for (const tx of transactions ?? []) {

                result.push({
                    accountNumber: account.number,

                    transactionDate:
                        tx.transactionDate ?? null,

                    postDate:
                        tx.postDate ?? null,

                    creditAmount:
                        tx.creditAmount ?? null,

                    debitAmount:
                        tx.debitAmount ?? null,

                    balanceAvailable:
                        tx.balanceAvailable ?? null,

                    transactionDesc:
                        tx.transactionDesc ?? "",

                    toAccountName:
                        tx.toAccountName ?? null,

                    toAccountNumber:
                        tx.toAccountNumber ?? null,

                    toBank:
                        tx.toBank ?? null,

                    refNo:
                        tx.refNo ?? null,
                });
            }

        } catch (error) {
            console.error(
                `❌ Lỗi lấy giao dịch ${account.number}:`,
                error
            );
        }
    }

    return result;
}

// ======================================================
// XỬ LÝ GIAO DỊCH
// ======================================================

async function processTransactions(
    transactions: any[]
): Promise<void> {

    for (const tx of transactions) {

        // Chỉ nhận giao dịch tiền vào
        const amount = Number(
            tx.creditAmount ?? 0
        );

        if (!Number.isFinite(amount) || amount <= 0) {
            continue;
        }

        const content = String(
            tx.transactionDesc ?? ""
        );

        const refNo = String(
            tx.refNo ?? ""
        ).trim();

        if (!refNo) {
            console.log(
                "⚠️ Giao dịch không có refNo, bỏ qua."
            );

            continue;
        }

        // Tìm mã CICI nếu có
        const match = content.match(
            /CICI([0-9]{12})/i
        );

        const orderCode = match
            ? `CICI${match[1]}`.toUpperCase()
            : "";

        console.log("");
        console.log("========================================");
        console.log("🔔 PHÁT HIỆN GIAO DỊCH TIỀN VÀO");
        console.log("========================================");

        console.log(
            "Order:",
            orderCode || "Chưa có mã đơn"
        );

        console.log("Amount:", amount);
        console.log("RefNo:", refNo);
        console.log("Content:", content);

        // Gửi tất cả giao dịch tiền vào sang Laravel
        // Laravel tự kiểm tra mã đơn và chống trùng
        await sendPaymentToLaravel(
            tx,
            orderCode
        );
    }
}

// ======================================================
// CHẠY 1 VÒNG
// ======================================================

async function runOnce(): Promise<void> {

    console.log("");
    console.log("========================================");

    console.log(
        `🚀 Kiểm tra MB: ${new Date().toLocaleString("vi-VN")}`
    );

    console.log("========================================");

    try {
        const transactions =
            await getTodayTransactions();

        console.log(
            `📜 Tìm thấy ${transactions.length} giao dịch`
        );

        await processTransactions(transactions);

    } catch (error) {
        console.error(
            "❌ Lỗi vòng kiểm tra:",
            error
        );
    }
}

// ======================================================
// SERVICE LOOP
// ======================================================

async function loop(): Promise<void> {

    console.log("");
    console.log("========================================");

    console.log(
        "🏦 CICI MB PAYMENT SERVICE"
    );

    console.log(
        "⏱️ Chu kỳ: 30 giây"
    );

    console.log(
        "📦 Chống trùng: Laravel Database"
    );

    console.log("========================================");

    while (true) {

        await runOnce();

        console.log("");
        console.log("⏳ Chờ 30 giây...");

        await sleep(CHECK_INTERVAL);
    }
}

// ======================================================
// START
// ======================================================

loop().catch(error => {

    console.error(
        "❌ FATAL ERROR:",
        error
    );

    process.exit(1);
});
