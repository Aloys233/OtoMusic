var config = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            boxShadow: {
                glass: "0 16px 50px -24px rgba(15, 23, 42, 0.6)",
            },
        },
    },
    plugins: [],
};
export default config;
