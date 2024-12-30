def calculate_calories(age, gender, weight, height, activity_level, goal):
    # Формула Маффина-Джеора
    if gender == "male":
        bmr = 10 * weight + 6.25 * height - 5 * age + 5
    else:
        bmr = 10 * weight + 6.25 * height - 5 * age - 161

    if activity_level == "low":
        bmr *= 1.2
    elif activity_level == "medium":
        bmr *= 1.55
    elif activity_level == "high":
        bmr *= 1.725

    # Цель: для "сбросить вес" – дефицит 20%, для "набор массы" можно наоборот увеличить, для "поддержание" оставить без изменений.
    if goal == "loss":
        bmr = bmr * 0.8
    elif goal == "gain":
        bmr = bmr * 1.1  # например, +10%

    # Распределение БЖУ в %: Белки - 30%, Жиры - 30%, Углеводы - 40%
    # Переводим проценты калорий в граммы:
    # 1 г белка = 4 ккал; 1 г углеводов = 4 ккал; 1 г жиров = 9 ккал
    protein_cal = bmr * 0.3
    fat_cal = bmr * 0.3
    carbs_cal = bmr * 0.4

    protein_g = protein_cal / 4
    fat_g = fat_cal / 9
    carbs_g = carbs_cal / 4

    return bmr, protein_g, fat_g, carbs_g
