
import MB from "./MB";

// ================================
// CẤU HÌNH LARAVEL
// ================================

const laravelPaymentUrl =
    "http://gpt.x/api/mb/payment";

const laravelSecret = "key";

// ================================
// CẤU HÌNH TÀI KHOẢN
// ================================

const username = "0342234522";
const password = "Ndq0202@@";

if (!username || !password) {
    throw new Error("Thiếu username hoặc password");
}

// Tạo MB MỘT LẦN duy nhất.
// Không tạo lại MB trong vòng lặp.
const mb = new MB({
    username,
    password,
});

// ================================
// SLEEP
// ================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ================================
// LẤY NGÀY HÔM NAY
// DD/MM/YYYY
// ================================

function getToday(): string {
    const now = new Date();

    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();

    return `${day}/${month}/${year}`;
}

// ================================
// CHẠY 1 LẦN
// ================================

async function runOnce(): Promise<void> {
    console.log("\n========================================");
    console.log(
        `🚀 Bắt đầu: ${new Date().toLocaleString("vi-VN")}`
    );
    console.log("========================================");

    const transactions = await getTodayTransactions();

    console.log(`📜 Có ${transactions.length} giao dịch`);

    for (const tx of transactions) {
        const content = tx.transactionDesc ?? "";
        const amount = Number(tx.creditAmount ?? 0);
        const refNo = tx.refNo ?? "";

        console.log({
            amount,
            content,
            refNo,
        });

        // Chỉ xử lý giao dịch có CICIKEY + 12 chữ số
        const match = content.match(/CICIKEY([0-9]{12})/);

        if (!match) {
            continue;
        }

        const orderCode = match[1];

        console.log("\n💰 PHÁT HIỆN GIAO DỊCH CICIKEY");
        console.log("Order:", orderCode);
        console.log("Amount:", amount);
        console.log("RefNo:", refNo);

        if (!refNo) {
            console.log("⚠️ Không có refNo, bỏ qua");
            continue;
        }

        try {
            const response = await fetch(laravelPaymentUrl, {
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
                        date: tx.transactionDate ?? new Date().toISOString(),
                        account_receiver: tx.accountNumber,
                        gate: "MBBANK",
                    },
                }),
            });

            const responseText = await response.text();

            console.log(
                `📡 Laravel HTTP ${response.status}:`,
                responseText
            );

            if (!response.ok) {
                throw new Error(
                    `Laravel trả HTTP ${response.status}`
                );
            }

            console.log(
                `✅ Đã gửi giao dịch ${refNo} → Laravel`
            );

        } catch (error) {
            console.error(
                `❌ Gửi Laravel thất bại ${refNo}:`,
                error
            );
        }
    }
}
// ================================
// CHẠY LIÊN TỤC MỖI 5 PHÚT
// ================================

async function loop(): Promise<void> {
    while (true) {
        try {
            await runOnce();
        } catch (error) {
            console.error("\n❌ Lỗi:", error);
        }

        console.log(
            "\n⏳ Chờ 5 phút trước lần kiểm tra tiếp theo..."
        );

        await sleep(5 * 60 * 1000);
    }
}

// ================================
// START
// ================================

loop().catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
});

async function getTodayTransactions() {
    const balance = await mb.getBalance();

    if (!balance?.balances?.length) {
        throw new Error("Không lấy được danh sách tài khoản MB");
    }

    const today = getToday();

    const result = [];

    for (const account of balance.balances) {
        if (!account.number) {
            continue;
        }

        try {
            const transactions = await mb.getTransactionsHistory({
                accountNumber: account.number,
                fromDate: today,
                toDate: today,
            });

            for (const tx of transactions ?? []) {
                result.push({
                    accountNumber: account.number,

                    transactionDate: tx.transactionDate,
                    postDate: tx.postDate,

                    creditAmount: tx.creditAmount ?? null,
                    debitAmount: tx.debitAmount ?? null,

                    balanceAvailable: tx.balanceAvailable ?? null,

                    transactionDesc: tx.transactionDesc ?? "",

                    toAccountName: tx.toAccountName ?? null,
                    toAccountNumber: tx.toAccountNumber ?? null,
                    toBank: tx.toBank ?? null,

                    refNo: tx.refNo ?? null,
                });
            }
        } catch (error) {
            console.error(
                `Lỗi lấy giao dịch ${account.number}:`,
                error
            );
        }
    }

    return result;
}
